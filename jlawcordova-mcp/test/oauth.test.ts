import { env, exports } from "cloudflare:workers";

const worker = (exports as unknown as { default: Fetcher }).default;
import { describe, expect, it } from "vitest";
import { useFakeNetwork } from "./fake-network.js";

const { net } = useFakeNetwork();

const ORIGIN = "https://mcp.test";
const REDIRECT = "https://client.test/cb";

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

class Cookies {
  private jar = new Map<string, string>();
  absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair = ""] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === "" || /max-age=0/i.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
  header() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

const fetchWorker = (path: string, init?: RequestInit) => worker.fetch(`${ORIGIN}${path}`, { redirect: "manual", ...init });

async function registerClient() {
  const res = await fetchWorker("/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Test <b>Client</b>",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

/** Runs /authorize → consent → redirect to GitHub, and returns what the callback needs. */
async function authorizeUpToGithub(opts: { decision?: "approve" | "deny" } = {}) {
  const clientId = await registerClient();
  const { verifier, challenge } = await pkce();
  const cookies = new Cookies();

  const authorize = await fetchWorker(
    `/authorize?` +
      new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "client-state",
        resource: `${ORIGIN}/mcp`,
      }),
  );
  expect(authorize.status).toBe(200);
  cookies.absorb(authorize);
  const page = await authorize.text();
  const handle = /name="handle" value="([^"]+)"/.exec(page)?.[1];
  expect(handle).toBeTruthy();

  const consent = await fetchWorker("/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies.header() },
    body: new URLSearchParams({ handle: handle!, decision: opts.decision ?? "approve" }),
  });
  cookies.absorb(consent);
  return { clientId, verifier, cookies, page, authorize, consent };
}

async function finishCallback(cookies: Cookies, githubRedirect: string) {
  const state = new URL(githubRedirect).searchParams.get("state")!;
  const res = await fetchWorker(`/callback?code=gh-code&state=${encodeURIComponent(state)}`, {
    headers: { cookie: cookies.header() },
  });
  cookies.absorb(res);
  return res;
}

const grantKeys = async () => (await env.OAUTH_KV.list({ prefix: "grant:" })).keys.length;

describe("OAuth in front of /mcp", () => {
  it("M1: /mcp without a token is 401 with a discovery challenge", async () => {
    const res = await fetchWorker("/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("M1: /mcp with a bogus token is 401", async () => {
    const res = await fetchWorker("/mcp", { method: "POST", headers: { authorization: "Bearer nope" }, body: "{}" });
    expect(res.status).toBe(401);
  });

  it("publishes discovery metadata at the spec's routes", async () => {
    const meta = (await (await fetchWorker("/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
    expect(meta.issuer).toBe(ORIGIN);
    expect(meta.authorization_endpoint).toBe(`${ORIGIN}/authorize`);
    expect(meta.token_endpoint).toBe(`${ORIGIN}/token`);
    expect(meta.registration_endpoint).toBe(`${ORIGIN}/register`);
    const resource = (await (await fetchWorker("/.well-known/oauth-protected-resource/mcp")).json()) as Record<string, unknown>;
    expect(resource.resource).toBe(`${ORIGIN}/mcp`);
  });
});

describe("authorize and callback", () => {
  it("shows a consent page that escapes the client's name and cannot be framed", async () => {
    const { page, authorize } = await authorizeUpToGithub();
    expect(page).toContain("Test &#60;b&#62;Client&#60;/b&#62;");
    expect(page).not.toContain("<b>Client</b>");
    expect(authorize.headers.get("x-frame-options")).toBe("DENY");
    expect(authorize.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("starts GitHub sign-in only after consent, with no scope and the exact callback URL", async () => {
    const { consent } = await authorizeUpToGithub();
    expect(consent.status).toBe(302);
    const github = new URL(consent.headers.get("location")!);
    expect(github.origin + github.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(github.searchParams.get("client_id")).toBe("test-github-client-id");
    expect(github.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/callback`);
    expect(github.searchParams.get("scope")).toBeNull();
    expect(github.searchParams.get("state")).toBeTruthy();
  });

  it("Deny sends the client access_denied and never reaches GitHub", async () => {
    const { consent } = await authorizeUpToGithub({ decision: "deny" });
    const to = new URL(consent.headers.get("location")!);
    expect(to.origin + to.pathname).toBe(REDIRECT);
    expect(to.searchParams.get("error")).toBe("access_denied");
    expect(to.searchParams.get("state")).toBe("client-state");
  });

  it("the whole flow for the owner ends with a token that works on /mcp", async () => {
    const { clientId, verifier, cookies, consent } = await authorizeUpToGithub();
    const callback = await finishCallback(cookies, consent.headers.get("location")!);
    expect(callback.status).toBe(302);
    const back = new URL(callback.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("client-state");
    const code = back.searchParams.get("code")!;
    expect(code).toBeTruthy();

    // GitHub's token was used for the owner check and is not kept.
    expect(net.callsTo("login/oauth/access_token")).toHaveLength(1);
    expect(JSON.parse(net.callsTo("login/oauth/access_token")[0]!.body)).toMatchObject({
      client_secret: "test-github-client-secret-SECRET",
      code: "gh-code",
    });
    expect(net.callsTo("api.github.com/user")).toHaveLength(1);

    const token = await fetchWorker("/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
        resource: `${ORIGIN}/mcp`,
      }),
    });
    expect(token.status).toBe(200);
    const { access_token } = (await token.json()) as { access_token: string };
    expect(await grantKeys()).toBe(1);

    const mcp = await fetchWorker("/mcp", {
      method: "POST",
      headers: {
        host: "mcp.test", // the edge sets this in production; a service-binding call doesn't
        authorization: `Bearer ${access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_accomplishments", arguments: {} },
      }),
    });
    const body = await mcp.text();
    expect(`${mcp.status} ${body}`).toMatch(/^200/);
    expect(body).toContain('\\"items\\": []');
  });

  it("M2: a GitHub user with a different ID gets 403 and no grant", async () => {
    net.githubUser = { id: 999, login: "someone-else" };
    const { cookies, consent } = await authorizeUpToGithub();
    const callback = await finishCallback(cookies, consent.headers.get("location")!);
    expect(callback.status).toBe(403);
    expect(await callback.text()).toBe("Forbidden");
    expect(callback.headers.get("location")).toBeNull();
    expect(await grantKeys()).toBe(0);
    expect(net.logs.join("\n")).toContain("owner check failed");
    expect(net.logs.join("\n")).not.toContain("someone-else");
  });

  it("M3: the right login with a different ID is refused", async () => {
    net.githubUser = { id: 999, login: "jlawcordova" };
    const { cookies, consent } = await authorizeUpToGithub();
    const callback = await finishCallback(cookies, consent.headers.get("location")!);
    expect(callback.status).toBe(403);
    expect(await grantKeys()).toBe(0);
  });

  it("the right ID with a different login is refused too", async () => {
    net.githubUser = { id: 21234671, login: "not-jlawcordova" };
    const { cookies, consent } = await authorizeUpToGithub();
    const callback = await finishCallback(cookies, consent.headers.get("location")!);
    expect(callback.status).toBe(403);
    expect(await grantKeys()).toBe(0);
  });

  it("accepts the login in any case", async () => {
    net.githubUser = { id: 21234671, login: "JLawCordova" };
    const { cookies, consent } = await authorizeUpToGithub();
    const callback = await finishCallback(cookies, consent.headers.get("location")!);
    expect(callback.status).toBe(302);
    expect(await grantKeys()).toBe(1);
  });

  it("a callback without the browser's binding cookie is refused", async () => {
    const { consent } = await authorizeUpToGithub();
    const state = new URL(consent.headers.get("location")!).searchParams.get("state")!;
    const res = await fetchWorker(`/callback?code=gh-code&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(400);
    expect(await grantKeys()).toBe(0);
    expect(net.callsTo("login/oauth/access_token")).toHaveLength(0);
  });

  it("a state value works only once", async () => {
    const { cookies, consent } = await authorizeUpToGithub();
    const location = consent.headers.get("location")!;
    const jar = cookies.header();
    expect((await finishCallback(cookies, location)).status).toBe(302);
    const replay = await fetchWorker(`/callback?code=gh-code&state=${encodeURIComponent(new URL(location).searchParams.get("state")!)}`, {
      headers: { cookie: jar },
    });
    expect(replay.status).toBe(400);
  });

  it("GitHub returning an error sends the client access_denied", async () => {
    const { cookies, consent } = await authorizeUpToGithub();
    const state = new URL(consent.headers.get("location")!).searchParams.get("state")!;
    const res = await fetchWorker(`/callback?error=access_denied&state=${encodeURIComponent(state)}`, {
      headers: { cookie: cookies.header() },
    });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
    expect(await grantKeys()).toBe(0);
  });
});
