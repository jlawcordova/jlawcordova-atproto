import { beforeEach, describe, expect, it } from "vitest";
import { run, type Deps } from "../src/cli.ts";

const WORKER = "https://worker.test";
const NEW_TOKEN = "gho_fakeFreshDeviceToken0123456789ab";
const CLIENT_ID = "Ov23lip0SZYBKRd9VIJ3";

interface Call {
  method: string;
  url: string;
  headers: Headers;
  body: string;
}

let calls: Call[];
/** What GitHub's access_token endpoint answers on each poll, in order. The last one repeats. */
let polls: Record<string, unknown>[];
let deviceCode: Record<string, unknown>;
let workerStatus: number;
let workerBody: unknown;
let stored: string[];
let opened: string[];
let sleeps: number[];

beforeEach(() => {
  calls = [];
  polls = [{ access_token: NEW_TOKEN, token_type: "bearer", scope: "" }];
  deviceCode = {
    device_code: "dev-code-123",
    user_code: "WDJB-MJHT",
    verification_uri: "https://github.com/login/device",
    expires_in: 900,
    interval: 5,
  };
  workerStatus = 200;
  workerBody = { items: [], total: 0, skippedInvalid: 0 };
  stored = [];
  opened = [];
  sleeps = [];
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fakeFetch: typeof fetch = async (input, init) => {
  const req = new Request(input as string | URL | Request, init);
  const call: Call = { method: req.method, url: req.url, headers: req.headers, body: await req.clone().text() };
  calls.push(call);
  if (call.url === "https://github.com/login/device/code") return json(deviceCode);
  if (call.url === "https://github.com/login/oauth/access_token") {
    const pollIndex = calls.filter((c) => c.url === call.url).length - 1;
    return json(polls[Math.min(pollIndex, polls.length - 1)]);
  }
  if (call.url.startsWith(WORKER)) return json(workerBody, workerStatus);
  return new Response("unexpected", { status: 599 });
};

async function login(opts: { platform?: string; storeFails?: boolean; openFails?: boolean; env?: Record<string, string>; argv?: string[] } = {}) {
  let stdout = "";
  let stderr = "";
  const deps: Deps = {
    env: { ACCOMPLISHMENTS_URL: WORKER, ...opts.env },
    fetch: fakeFetch,
    readStdin: async () => "",
    readKeychainToken: async () => undefined,
    storeToken: async (token) => {
      if (opts.storeFails) throw new Error("denied");
      stored.push(token);
    },
    platform: opts.platform ?? "darwin",
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    openUrl: async (url) => {
      opened.push(url);
      if (opts.openFails) throw new Error("no browser");
    },
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
  };
  const code = await run(opts.argv ?? ["login"], deps);
  return { code, stdout, stderr };
}

const githubCalls = (suffix: string) => calls.filter((c) => c.url.endsWith(suffix));

describe("login", () => {
  it("C8: shows the code, waits through authorization_pending, then stores the token", async () => {
    polls = [{ error: "authorization_pending" }, { error: "authorization_pending" }, { access_token: NEW_TOKEN }];
    const out = await login();

    expect(out.code).toBe(0);
    expect(out.stderr).toContain("https://github.com/login/device");
    expect(out.stderr).toContain("WDJB-MJHT");
    expect(opened).toEqual(["https://github.com/login/device"]);
    expect(sleeps).toEqual([5000, 5000, 5000]);
    expect(stored).toEqual([NEW_TOKEN]);
    expect(JSON.parse(out.stdout)).toEqual({ loggedIn: true, login: "jlawcordova", worker: WORKER });
  });

  it("C8: asks GitHub for a code with the client ID and no scope, then polls with the device code", async () => {
    await login();
    const [start] = githubCalls("/login/device/code");
    expect(start!.method).toBe("POST");
    expect(start!.headers.get("accept")).toBe("application/json");
    const startForm = new URLSearchParams(start!.body);
    expect(startForm.get("client_id")).toBe(CLIENT_ID);
    expect(startForm.has("scope")).toBe(false);

    const [poll] = githubCalls("/login/oauth/access_token");
    const pollForm = new URLSearchParams(poll!.body);
    expect(pollForm.get("client_id")).toBe(CLIENT_ID);
    expect(pollForm.get("device_code")).toBe("dev-code-123");
    expect(pollForm.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
  });

  it("C8: ACCOMPLISHMENTS_CLIENT_ID overrides the default client ID", async () => {
    await login({ env: { ACCOMPLISHMENTS_CLIENT_ID: "Iv1.custom" } });
    expect(new URLSearchParams(githubCalls("/login/device/code")[0]!.body).get("client_id")).toBe("Iv1.custom");
  });

  it("C8: slow_down widens the interval by 5 seconds", async () => {
    polls = [{ error: "slow_down" }, { error: "authorization_pending" }, { access_token: NEW_TOKEN }];
    const out = await login();
    expect(out.code).toBe(0);
    expect(sleeps).toEqual([5000, 10_000, 10_000]);
  });

  it("C8: access_denied and expired_token exit 3 and store nothing", async () => {
    for (const error of ["access_denied", "expired_token"]) {
      calls = [];
      polls = [{ error }];
      const out = await login();
      expect(out.code, error).toBe(3);
      expect(JSON.parse(out.stderr.split("\n").slice(1).join("\n")).error).toBe(error);
      expect(out.stdout).toBe("");
      expect(stored).toEqual([]);
      expect(calls.filter((c) => c.url.startsWith(WORKER))).toHaveLength(0);
    }
  });

  it("C8: giving up when the code's lifetime has passed exits 3", async () => {
    deviceCode.expires_in = 12;
    polls = [{ error: "authorization_pending" }];
    const out = await login();
    expect(out.code).toBe(3);
    expect(sleeps).toEqual([5000, 5000, 5000]);
    expect(out.stderr).toContain("expired_token");
    expect(stored).toEqual([]);
  });

  it("C8: a closed browser or failed open isn't an error", async () => {
    expect((await login({ openFails: true })).code).toBe(0);
  });

  it("only opens a verification page on github.com", async () => {
    deviceCode.verification_uri = "https://evil.test/login";
    await login();
    expect(opened).toEqual([]);
  });

  it("explains when Device Flow is switched off for the OAuth App", async () => {
    deviceCode = { error: "device_flow_disabled" };
    const out = await login();
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("Enable Device Flow");
    expect(sleeps).toEqual([]);
  });
});

describe("login checks the token with the Worker before saving it", () => {
  it("checks with GET /api/accomplishments?limit=1 and the new token", async () => {
    await login();
    const [check] = calls.filter((c) => c.url.startsWith(WORKER));
    expect(check!.method).toBe("GET");
    expect(check!.url).toBe(`${WORKER}/api/accomplishments?limit=1`);
    expect(check!.headers.get("authorization")).toBe(`Bearer ${NEW_TOKEN}`);
  });

  it("C9: a token for a different user (403) stores nothing and exits 3", async () => {
    workerStatus = 403;
    workerBody = { error: "forbidden", message: "This GitHub account isn't allowed to use the accomplishments API." };
    const out = await login();
    expect(out.code).toBe(3);
    expect(stored).toEqual([]);
    expect(out.stdout).toBe("");
    expect(out.stderr).toContain("jlawcordova");
  });

  it("a rejected token (401), an outage (503), or a refusal stores nothing", async () => {
    for (const status of [401, 503, 502]) {
      workerStatus = status;
      workerBody = { error: "x", message: "m" };
      const out = await login();
      expect(out.code, String(status)).toBe(status === 502 ? 1 : 3);
      expect(stored).toEqual([]);
    }
  });

  it("a keychain that won't save the token exits 1 and doesn't claim success", async () => {
    const out = await login({ storeFails: true });
    expect(out.code).toBe(1);
    expect(out.stdout).toBe("");
    expect(JSON.parse(out.stderr.split("\n").slice(1).join("\n")).error).toBe("keychain");
  });
});

describe("login guards", () => {
  it("off macOS it says to use ACCOMPLISHMENTS_TOKEN and sends nothing", async () => {
    const out = await login({ platform: "linux" });
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("ACCOMPLISHMENTS_TOKEN");
    expect(calls).toEqual([]);
  });

  it("login takes no arguments", async () => {
    const out = await login({ argv: ["login", "extra"] });
    expect(out.code).toBe(2);
    expect(calls).toEqual([]);
  });

  it("C11: the new token is in no stdout or stderr, on any path", async () => {
    const outputs = [await login()];
    workerStatus = 403;
    outputs.push(await login());
    workerStatus = 200;
    outputs.push(await login({ storeFails: true }));
    polls = [{ access_token: NEW_TOKEN, error: "access_denied" }];
    outputs.push(await login());
    for (const out of outputs) {
      expect(out.stdout).not.toContain(NEW_TOKEN);
      expect(out.stderr).not.toContain(NEW_TOKEN);
    }
  });
});
