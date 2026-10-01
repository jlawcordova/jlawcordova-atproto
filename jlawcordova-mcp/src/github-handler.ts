import {
  AuthorizationError,
  CimdFetchError,
  authorizationErrorRedirect,
  type ConsentDescription,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import type { AuthProps, Env } from "./env.js";
import { log } from "./log.js";
import { isOwner } from "./owner.js";

type HandlerEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function text(body: string, status: number, headers?: Headers): Response {
  const h = new Headers(headers);
  h.set("content-type", "text/plain; charset=utf-8");
  return new Response(body, { status, headers: h });
}

function redirect(location: string, headers: Headers): Response {
  headers.set("location", location);
  return new Response(null, { status: 302, headers });
}

/** Everything here came from the client's registration, so it is escaped. */
function consentPage(details: ConsentDescription, handle: string, login: string): string {
  const name = escapeHtml(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : "This app registered itself, so its name is not verified.";
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize ${name}</title>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5">
<h1>Allow ${name} to use jlawcordova-mcp?</h1>
<p>${origin} Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>" : ""}
<p>It will be able to list, add, and delete public accomplishment records. Next you sign in with GitHub; only the account <strong>${escapeHtml(login)}</strong> is accepted.</p>
<form method="post">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <button name="decision" value="approve">Allow and sign in with GitHub</button>
  <button name="decision" value="deny">Deny</button>
</form>
</body>`;
}

async function showConsent(request: Request, env: HandlerEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const authRequest = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(authRequest);
  const consent = await oauth.beginConsent(authRequest);
  consent.headers.set("content-type", "text/html; charset=utf-8");
  return new Response(consentPage(details, consent.handle, env.ALLOWED_GITHUB_LOGIN), { headers: consent.headers });
}

async function submitConsent(request: Request, env: HandlerEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const form = await request.formData();
  const handle = String(form.get("handle"));

  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }

  // Only now, after consent, does the GitHub redirect start.
  const approved = await oauth.approveConsent(request, handle);
  const { state, headers } = await oauth.beginUpstream(approved.request, { headers: approved.headers });
  const github = new URL("https://github.com/login/oauth/authorize");
  github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  github.searchParams.set("redirect_uri", new URL("/callback", env.PUBLIC_URL).href);
  github.searchParams.set("state", state);
  github.searchParams.set("allow_signup", "false"); // no scope: public profile only
  return redirect(github.href, headers);
}

async function fetchGithubUser(code: string, env: HandlerEnv): Promise<{ id?: unknown; login?: unknown } | null> {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "jlawcordova-mcp" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL("/callback", env.PUBLIC_URL).href,
    }),
  });
  const token = tokenRes.ok ? ((await tokenRes.json()) as { access_token?: unknown }).access_token : undefined;
  if (typeof token !== "string") {
    log({ event: "github", outcome: "token_exchange_failed", status: tokenRes.status });
    return null;
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "jlawcordova-mcp",
    },
  });
  if (!userRes.ok) {
    log({ event: "github", outcome: "user_lookup_failed", status: userRes.status });
    return null;
  }
  return (await userRes.json()) as { id?: unknown; login?: unknown };
}

async function handleCallback(request: Request, env: HandlerEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const params = new URL(request.url).searchParams;
  const { request: original, headers } = await oauth.finishUpstream(request);

  if (params.get("error")) {
    return redirect(authorizationErrorRedirect(original, "access_denied"), headers);
  }
  const code = params.get("code");
  if (!code) return text("Missing authorization code.", 400, headers);

  const user = await fetchGithubUser(code, env);
  if (!user) return text("Sign-in with GitHub failed.", 502, headers);

  // The owner check: numeric ID and login must both match. Nothing about the
  // other user is logged, and no grant is issued.
  if (!isOwner(env, user)) {
    log({ event: "owner check failed" });
    return text("Forbidden", 403, headers);
  }

  const props: AuthProps = { githubId: user.id as number, login: user.login as string };
  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: String(props.githubId),
    metadata: {},
    scope: original.scope,
    props, // the GitHub access token is not stored; it isn't needed after the check
  });
  log({ event: "owner check passed" });
  return redirect(redirectTo, headers);
}

export const githubHandler = {
  async fetch(request: Request, env: HandlerEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/authorize" && request.method === "GET") return await showConsent(request, env);
      if (pathname === "/authorize" && request.method === "POST") return await submitConsent(request, env);
      if (pathname === "/callback" && request.method === "GET") return await handleCallback(request, env);
      return text("Not found", 404);
    } catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo) {
        return Response.redirect(error.redirectTo, 302);
      }
      if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
        const message = error instanceof AuthorizationError ? error.description : "This app could not be verified.";
        return text(message ?? "Invalid authorization request.", 400);
      }
      throw error;
    }
  },
};
