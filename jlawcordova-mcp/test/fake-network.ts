import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, vi } from "vitest";

export const DID = "did:plc:ewvi7nxzyoun6zhxrhs64oiz";
export const PDS = "https://pds.test";
export const NSID = "com.jlawcordova.profile.accomplishment";
export const SECRETS = ["test-app-password-SECRET", "test-dispatch-token-SECRET", "test-github-client-secret-SECRET"];

export interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body: string;
}

export interface StoredRecord {
  uri: string;
  cid: string;
  value: unknown;
}

const B32 = "234567abcdefghijklmnopqrstuvwxyz";
export const tid = (n: number) => `3jzfcijpj2z2${B32[n % 32]}`;

/** A fake PDS, PLC directory, GitHub, and GitHub OAuth, behind a spy on `fetch`. */
export class FakeNetwork {
  calls: Call[] = [];
  logs: string[] = [];

  // PDS
  records = new Map<string, StoredRecord>();
  validAccess = new Set<string>();
  validRefresh = new Set<string>();
  sessionCounter = 0;
  refreshFails = false;
  sessionDid = DID;
  pageSize = 100;
  private recordCounter = 0;

  // GitHub
  dispatchStatus = 204;
  dispatchThrows: Error | undefined;
  githubUser: { id: number; login: string } = { id: 21234671, login: "jlawcordova" };

  callsTo(pattern: string | RegExp, method?: string): Call[] {
    return this.calls.filter(
      (c) =>
        (typeof pattern === "string" ? c.url.href.includes(pattern) : pattern.test(c.url.href)) &&
        (method === undefined || c.method === method),
    );
  }

  /** Seeds an access/refresh pair as if a previous run had stored it. */
  seedSession(access: string, refresh: string, opts: { accessValid: boolean; refreshValid: boolean }) {
    if (opts.accessValid) this.validAccess.add(access);
    if (opts.refreshValid) this.validRefresh.add(refresh);
    return { accessJwt: access, refreshJwt: refresh, handle: "jlawcordova.com", did: DID, active: true };
  }

  addRecord(value: unknown, rkey = tid(this.recordCounter++)) {
    const uri = `at://${DID}/${NSID}/${rkey}`;
    this.records.set(rkey, { uri, cid: "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm", value });
    return rkey;
  }

  private newSession() {
    const n = ++this.sessionCounter;
    const session = { accessJwt: `access-${n}`, refreshJwt: `refresh-${n}`, handle: "jlawcordova.com", did: this.sessionDid, active: true };
    this.validAccess.add(session.accessJwt);
    this.validRefresh.add(session.refreshJwt);
    return session;
  }

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  private expired() {
    return this.json({ error: "ExpiredToken", message: "Token has expired" }, 400);
  }

  private bearer(call: Call) {
    return call.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  }

  private async handle(call: Call): Promise<Response> {
    const { host, pathname, searchParams } = call.url;

    if (host === "public.api.bsky.app" && pathname.endsWith("/com.atproto.identity.resolveHandle")) {
      return this.json({ did: DID });
    }
    if (host === "plc.directory") {
      return this.json({
        id: DID,
        service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }],
      });
    }

    if (host === "pds.test") {
      const method = pathname.replace("/xrpc/", "");
      switch (method) {
        case "com.atproto.server.createSession": {
          const body = JSON.parse(call.body);
          if (body.password !== "test-app-password-SECRET") return this.json({ error: "AuthenticationRequired" }, 401);
          return this.json(this.newSession());
        }
        case "com.atproto.server.refreshSession": {
          const token = this.bearer(call);
          if (this.refreshFails || !this.validRefresh.has(token)) return this.expired();
          this.validRefresh.delete(token);
          return this.json(this.newSession());
        }
        case "com.atproto.server.getSession":
          if (!this.validAccess.has(this.bearer(call))) return this.expired();
          return this.json({ did: DID, handle: "jlawcordova.com", active: true });
        case "com.atproto.repo.listRecords": {
          const all = [...this.records.values()];
          const start = Number(searchParams.get("cursor") ?? 0);
          const size = Math.min(Number(searchParams.get("limit") ?? 50), this.pageSize);
          const records = all.slice(start, start + size);
          const next = start + size;
          return this.json({ records, ...(next < all.length && { cursor: String(next) }) });
        }
        case "com.atproto.repo.getRecord": {
          const rkey = searchParams.get("rkey")!;
          const record = this.records.get(rkey);
          if (!record) return this.json({ error: "RecordNotFound", message: "Could not locate record" }, 400);
          return this.json(record);
        }
        case "com.atproto.repo.createRecord": {
          if (!this.validAccess.has(this.bearer(call))) return this.expired();
          const body = JSON.parse(call.body);
          const rkey = this.addRecord(body.record);
          const stored = this.records.get(rkey)!;
          return this.json({ uri: stored.uri, cid: stored.cid });
        }
        case "com.atproto.repo.deleteRecord": {
          if (!this.validAccess.has(this.bearer(call))) return this.expired();
          const body = JSON.parse(call.body);
          this.records.delete(body.rkey);
          return this.json({});
        }
      }
    }

    if (host === "api.github.com" && pathname.endsWith("/dispatches")) {
      if (this.dispatchThrows) throw this.dispatchThrows;
      return new Response(null, { status: this.dispatchStatus });
    }
    if (host === "api.github.com" && pathname === "/user") return this.json(this.githubUser);
    if (host === "github.com" && pathname === "/login/oauth/access_token") {
      return this.json({ access_token: "gho_fake_access_token", token_type: "bearer" });
    }

    return new Response(`unexpected request: ${call.method} ${call.url.href}`, { status: 599 });
  }

  install() {
    const original = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const req = new Request(input as RequestInfo, init);
      const call: Call = {
        method: req.method,
        url: new URL(req.url),
        headers: req.headers,
        body: await req.clone().text(),
      };
      this.calls.push(call);
      return this.handle(call);
    });
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        this.logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
    return original;
  }
}

/** M13: whatever a test did, the logs hold no secret, JWT, or record text. */
export function expectCleanLogs(logs: string[], extraForbidden: string[] = []) {
  const joined = logs.join("\n");
  for (const forbidden of [...SECRETS, ...extraForbidden, "access-", "refresh-", "gho_fake", "Bearer "]) {
    expect(joined).not.toContain(forbidden);
  }
}

/** Installs a fresh fake network for each test and checks the logs afterwards. */
export function useFakeNetwork(): { net: FakeNetwork } {
  // One instance for the whole file, reset before each test, so tests can
  // destructure `net` at module level.
  const net = new FakeNetwork();
  beforeEach(async () => {
    // Storage is not isolated between tests in a file, so empty KV by hand.
    let cursor: string | undefined;
    do {
      const page = await env.OAUTH_KV.list({ cursor });
      await Promise.all(page.keys.map((k) => env.OAUTH_KV.delete(k.name)));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    Object.assign(net, new FakeNetwork());
    net.install();
  });
  afterEach(() => {
    const logs = net.logs;
    vi.restoreAllMocks();
    expectCleanLogs(logs, ["Cut deploy time", "Rebuilt the CI pipeline"]);
  });
  return { net };
}
