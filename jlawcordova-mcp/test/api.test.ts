import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { callTool } from "./call-tool.js";
import { NSID, SECRETS, tid, useFakeNetwork } from "./fake-network.js";

const worker = (exports as unknown as { default: Fetcher }).default;
const { net } = useFakeNetwork();

const ORIGIN = "https://mcp.test";
const OWNER_TOKEN = "gho_fakeOwnerToken0123456789abcdef";
const OTHER_TOKEN = "gho_fakeOtherUserToken0123456789ab";
const MISMATCH_TOKEN = "gho_fakeLoginMismatch0123456789ab";
const STRANGER_TOKEN = "gho_fakeUnknownToken0123456789abc";

const valid = {
  title: "Cut deploy time by 40%",
  description: "Rebuilt the CI pipeline, cutting deploys from 10 to 6 minutes.",
  funTitle: "Speed Demon",
  shortDescription: "Deploys now finish in six minutes",
  icon: "rocket",
  startDate: "2026-01",
  endDate: "2026-03",
  tags: ["CI"],
  links: ["https://github.com/jlawcordova/example/pull/1"],
};

const stored = (over: Record<string, unknown> = {}) => ({
  $type: NSID,
  title: "Something",
  description: "Did a thing.",
  startDate: "2026-01",
  createdAt: "2026-02-01T00:00:00.000Z",
  ...over,
});

function signIn() {
  net.appTokens.set(OWNER_TOKEN, { id: 21234671, login: "jlawcordova" });
  net.appTokens.set(OTHER_TOKEN, { id: 99, login: "netzon-jlaw" });
  net.appTokens.set(MISMATCH_TOKEN, { id: 21234671, login: "someone-else" });
}

async function api(path: string, init: RequestInit = {}, token: string | null = OWNER_TOKEN) {
  signIn();
  const headers = new Headers(init.headers);
  if (token !== null && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
  const res = await worker.fetch(`${ORIGIN}${path}`, { ...init, headers });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { res, status: res.status, text, json };
}

const post = (body: unknown, token: string | null = OWNER_TOKEN) =>
  api("/api/accomplishments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, token);

const ROUTES: [string, RequestInit][] = [
  ["/api/accomplishments", { method: "GET" }],
  ["/api/accomplishments", { method: "POST", body: JSON.stringify(valid) }],
  [`/api/accomplishments/${tid(1)}`, { method: "DELETE" }],
];

const tokenChecks = () => net.callsTo("/applications/");
const pdsTouched = () => net.calls.filter((c) => /pds\.test|public\.api\.bsky\.app|plc\.directory/.test(c.url.host));

describe("API authentication", () => {
  it("A1: no Authorization header → 401, GitHub not called", async () => {
    for (const [path, init] of ROUTES) {
      const { status, json } = await api(path, init, null);
      expect(status).toBe(401);
      expect(json.error).toBe("unauthorized");
    }
    expect(tokenChecks()).toHaveLength(0);
    expect(pdsTouched()).toHaveLength(0);
  });

  it("A2: a token in the wrong format → 401, GitHub not called", async () => {
    for (const header of ["Bearer abc", "Bearer ghp_0123456789abcdef0123456789abcdef0123", "Basic Zm9vOmJhcg==", "Bearer gho_short", "Bearer"]) {
      const { status } = await api("/api/accomplishments", { headers: { authorization: header } }, null);
      expect(status).toBe(401);
    }
    expect(tokenChecks()).toHaveLength(0);
  });

  it("A3: a well-formed token GitHub rejects (404 or 422) → 401", async () => {
    expect((await api("/api/accomplishments", {}, STRANGER_TOKEN)).status).toBe(401);
    net.tokenCheckStatus = 422;
    expect((await api("/api/accomplishments", {}, OWNER_TOKEN)).status).toBe(401);
    expect(pdsTouched()).toHaveLength(0);
  });

  it("A4: a token for a different GitHub user → 403 on every route, nothing written or deleted", async () => {
    const rkey = net.addRecord(stored());
    for (const [path, init] of [
      ["/api/accomplishments", { method: "GET" }],
      ["/api/accomplishments", { method: "POST", body: JSON.stringify(valid) }],
      [`/api/accomplishments/${rkey}`, { method: "DELETE" }],
    ] as [string, RequestInit][]) {
      const { status, json } = await api(path, init, OTHER_TOKEN);
      expect(status).toBe(403);
      expect(json.error).toBe("forbidden");
    }
    expect(pdsTouched()).toHaveLength(0);
    expect(net.records.size).toBe(1);
  });

  it("A5: the owner's ID with a different login → 403", async () => {
    expect((await api("/api/accomplishments", {}, MISMATCH_TOKEN)).status).toBe(403);
    expect(pdsTouched()).toHaveLength(0);
  });

  it("A6: the check goes to this app's token endpoint with its credentials, never GET /user", async () => {
    // A valid owner token issued to some other app is unknown to this app, so GitHub answers 404.
    expect((await api("/api/accomplishments", {}, STRANGER_TOKEN)).status).toBe(401);
    const [check] = tokenChecks();
    expect(check!.method).toBe("POST");
    expect(check!.url.pathname).toBe("/applications/test-github-client-id/token");
    expect(check!.headers.get("authorization")).toBe(`Basic ${btoa("test-github-client-id:test-github-client-secret-SECRET")}`);
    expect(JSON.parse(check!.body)).toEqual({ access_token: STRANGER_TOKEN });
    expect(net.callsTo("/user")).toHaveLength(0);
  });

  it("A7: GitHub failing, timing out, or unreachable → 503, request not served", async () => {
    net.tokenCheckStatus = 500;
    expect((await api("/api/accomplishments", {})).status).toBe(503);
    net.tokenCheckStatus = undefined;
    net.tokenCheckThrows = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect((await api("/api/accomplishments", {})).status).toBe(503);
    net.tokenCheckThrows = new TypeError("network down");
    const { status, json } = await post(valid);
    expect(status).toBe(503);
    expect(json.error).toBe("auth_unavailable");
    expect(pdsTouched()).toHaveLength(0);
  });
});

describe("GET /api/accomplishments", () => {
  it("A8: returns the same items, total and skippedInvalid as list_accomplishments, newest first", async () => {
    net.addRecord(stored({ title: "Old", startDate: "2025-01" }));
    net.addRecord(stored({ title: "New", startDate: "2026-05" }));
    net.addRecord({ not: "an accomplishment" });
    const { status, json } = await api("/api/accomplishments");
    expect(status).toBe(200);
    expect(json.items.map((i: { value: { title: string } }) => i.value.title)).toEqual(["New", "Old"]);
    expect(json.skippedInvalid).toBe(1);
    expect(json).toEqual((await callTool("list_accomplishments", {})).json());

    const filtered = await api("/api/accomplishments?since=2026-01&limit=1");
    expect(filtered.json.total).toBe(1);
    expect(filtered.json).toEqual((await callTool("list_accomplishments", { since: "2026-01", limit: 1 })).json());
  });

  it("A9: a bad since or limit → 400", async () => {
    for (const q of ["since=2026-13", "since=abc", "since=", "limit=0", "limit=101", "limit=1.5", "limit=abc", "limit="]) {
      const { status, json } = await api(`/api/accomplishments?${q}`);
      expect(status, q).toBe(400);
      expect(json.error).toBe("bad_request");
    }
  });
});

describe("POST /api/accomplishments", () => {
  it("A10: a valid body → 201, created once, read back identically through MCP list", async () => {
    const { status, json } = await post(valid);
    expect(status).toBe(201);
    expect(net.callsTo("createRecord")).toHaveLength(1);
    expect(json.rebuild).toBe("triggered");
    expect(net.callsTo("/dispatches")).toHaveLength(1);
    expect(json.record).toMatchObject({ $type: NSID, ...valid });
    expect(typeof json.record.createdAt).toBe("string");

    const listed = (await callTool("list_accomplishments", {})).json();
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ rkey: json.rkey, uri: json.uri, cid: json.cid, value: json.record });
  });

  it("A11: an invalid body → 422 with every error, nothing written", async () => {
    const { status, json } = await post({ ...valid, title: "   ", startDate: "2026-13", links: ["javascript:alert(1)"] });
    expect(status).toBe(422);
    expect(json.error).toBe("invalid");
    const fields = json.errors.map((e: { field: string }) => e.field);
    expect(fields).toEqual(expect.arrayContaining(["title", "startDate", "links[0]"]));
    expect(net.callsTo("createRecord")).toHaveLength(0);
    expect(net.callsTo("/dispatches")).toHaveLength(0);
  });

  it("U11: the new fields are accepted and required on POST", async () => {
    const { startDate: _, endDate: __, ...goal } = valid;
    const created = await post({ ...goal, done: false });
    expect(created.status).toBe(201);
    expect(created.json.record).toMatchObject({ funTitle: "Speed Demon", icon: "rocket", done: false });

    const { icon: ___, ...noIcon } = valid;
    const refused = await post(noIcon);
    expect(refused.status).toBe(422);
    expect(refused.json.errors).toEqual([{ field: "icon", message: "is required" }]);
    expect(net.callsTo("createRecord")).toHaveLength(1);
  });

  it("A11: a missing required field is reported", async () => {
    const { status, json } = await post({ title: "Only a title" });
    expect(status).toBe(422);
    expect(json.errors).toEqual(expect.arrayContaining([{ field: "description", message: "is required" }]));
  });

  it("A12: createdAt and $type in the body are ignored; unknown fields are refused", async () => {
    const { status, json } = await post({ ...valid, createdAt: "1999-01-01T00:00:00Z", $type: "something.else" });
    expect(status).toBe(201);
    expect(json.record.$type).toBe(NSID);
    expect(json.record.createdAt).not.toBe("1999-01-01T00:00:00Z");

    const refused = await post({ ...valid, organization: "Acme" });
    expect(refused.status).toBe(422);
    expect(refused.json.errors).toEqual([{ field: "organization", message: "is not a known field" }]);
    expect(net.callsTo("createRecord")).toHaveLength(1);
  });

  it("A13: a non-JSON or non-object body → 400; a body over 64 KiB → 413", async () => {
    for (const body of ["not json", "[1,2]", "null", '"text"', ""]) {
      const { status, json } = await api("/api/accomplishments", { method: "POST", body });
      expect(status, body).toBe(400);
      expect(json.error).toBe("bad_request");
    }
    const big = await post({ ...valid, description: "x".repeat(70_000) });
    expect(big.status).toBe(413);
    expect(big.json.error).toBe("too_large");
    expect(net.callsTo("createRecord")).toHaveLength(0);
  });
});

describe("DELETE /api/accomplishments/{rkey}", () => {
  it("A14: an existing rkey → 200 with the title and start date; the record is gone", async () => {
    const rkey = net.addRecord(stored({ title: "Remove me", startDate: "2026-02" }));
    const { status, json } = await api(`/api/accomplishments/${rkey}`, { method: "DELETE" });
    expect(status).toBe(200);
    expect(json).toEqual({ rkey, deleted: { title: "Remove me", startDate: "2026-02" }, rebuild: "triggered" });
    expect(net.records.has(rkey)).toBe(false);
  });

  it("A15: an unknown rkey → 404; a malformed one → 400; nothing deleted", async () => {
    net.addRecord(stored());
    const missing = await api(`/api/accomplishments/${tid(30)}`, { method: "DELETE" });
    expect(missing.status).toBe(404);
    expect(missing.json.error).toBe("not_found");
    for (const bad of ["nope", "%E0%A4%A", "3jzfcijpj2z2!"]) {
      const { status } = await api(`/api/accomplishments/${bad}`, { method: "DELETE" });
      expect(status, bad).toBe(400);
    }
    expect(net.callsTo("deleteRecord")).toHaveLength(0);
    expect(net.records.size).toBe(1);
  });
});

describe("errors and routing", () => {
  it("A16: a failed rebuild doesn't fail POST or DELETE", async () => {
    net.dispatchStatus = 500;
    const added = await post(valid);
    expect(added.status).toBe(201);
    expect(added.json.rebuild).toMatch(/^failed:/);

    const deleted = await api(`/api/accomplishments/${added.json.rkey}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(deleted.json.rebuild).toMatch(/^failed:/);
    expect(net.records.size).toBe(0);
  });

  it("A17: a PDS failure → 502 with no secret in the body", async () => {
    net.listStatus = 500;
    const { status, json, text } = await api("/api/accomplishments");
    expect(status).toBe(502);
    expect(json.error).toBe("upstream");
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  it("A18: an unknown path → 404; the wrong method → 405 with Allow", async () => {
    expect((await api("/api/nope")).status).toBe(404);
    expect((await api("/api/accomplishments/a/b", { method: "DELETE" })).status).toBe(404);

    const put = await api("/api/accomplishments", { method: "PUT" });
    expect(put.status).toBe(405);
    expect(put.res.headers.get("allow")).toBe("GET, POST");

    const get = await api(`/api/accomplishments/${tid(1)}`);
    expect(get.status).toBe(405);
    expect(get.res.headers.get("allow")).toBe("DELETE");
    expect(net.records.size).toBe(0);
  });

  it("A19: the token is in no response body or log, on success or error paths", async () => {
    const responses = [
      await api("/api/accomplishments"),
      await post(valid),
      await post({}),
      await api("/api/accomplishments", {}, OTHER_TOKEN),
      await api("/api/accomplishments", {}, STRANGER_TOKEN),
      await api("/api/accomplishments", {}, null),
    ];
    for (const r of responses) {
      for (const token of [OWNER_TOKEN, OTHER_TOKEN, STRANGER_TOKEN]) expect(r.text).not.toContain(token);
      expect(r.res.headers.get("cache-control")).toBe("no-store");
    }
    const logs = net.logs.join("\n");
    for (const token of [OWNER_TOKEN, OTHER_TOKEN, STRANGER_TOKEN]) expect(logs).not.toContain(token);
    expect(net.logs.some((l) => l.includes('"event":"api"'))).toBe(true);
    expect(logs).not.toContain("Cut deploy time");
  });

  it("R2: the MCP and OAuth routes are not claimed by the API", async () => {
    const mcp = await worker.fetch(`${ORIGIN}/mcp`, { method: "POST", body: "{}" });
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get("www-authenticate")).toBeTruthy();
    const meta = await worker.fetch(`${ORIGIN}/.well-known/oauth-authorization-server`);
    expect(meta.status).toBe(200);
    expect((await worker.fetch(`${ORIGIN}/api`)).status).not.toBe(200);
  });
});
