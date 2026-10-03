import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { callTool } from "./call-tool.js";
import { DID, useFakeNetwork } from "./fake-network.js";

const { net } = useFakeNetwork();

const SESSION_KEY = "atproto:session:v1";
const accomplishment = {
  title: "Shipped it",
  description: "Did a thing.",
  funTitle: "Shipper",
  shortDescription: "Shipped the thing without any drama",
  icon: "rocket",
  startDate: "2026-01",
};

const store = (session: unknown) => env.OAUTH_KV.put(SESSION_KEY, JSON.stringify(session));
const stored = () => env.OAUTH_KV.get<{ accessJwt: string; refreshJwt: string; did: string }>(SESSION_KEY, "json");

describe("PDS session", () => {
  it("logs in once when nothing is stored, and persists the session", async () => {
    expect((await callTool("add_accomplishment", accomplishment)).isError).toBe(false);
    expect(net.callsTo("createSession")).toHaveLength(1);
    expect(await stored()).toMatchObject({ did: DID });
  });

  it("M9: a stored valid session is reused: no createSession", async () => {
    await store(net.seedSession("stored-access", "stored-refresh", { accessValid: true, refreshValid: true }));
    const result = await callTool("add_accomplishment", accomplishment);
    expect(result.isError).toBe(false);
    expect(net.callsTo("createSession")).toHaveLength(0);
    expect(net.callsTo("refreshSession")).toHaveLength(0);
    expect(net.callsTo("createRecord")[0]!.headers.get("authorization")).toBe("Bearer stored-access");
  });

  it("M10: an expired access token is refreshed, not re-created, and the new session is saved", async () => {
    await store(net.seedSession("stale-access", "stored-refresh", { accessValid: false, refreshValid: true }));
    const result = await callTool("add_accomplishment", accomplishment);
    expect(result.isError).toBe(false);
    expect(net.callsTo("createSession")).toHaveLength(0);
    expect(net.callsTo("refreshSession")).toHaveLength(1);
    expect(net.callsTo("refreshSession")[0]!.headers.get("authorization")).toBe("Bearer stored-refresh");
    const saved = await stored();
    expect(saved?.accessJwt).toBe("access-1");
    expect(saved?.refreshJwt).toBe("refresh-1");
    const writes = net.callsTo("createRecord");
    expect(writes.map((c) => c.headers.get("authorization"))).toEqual(["Bearer stale-access", "Bearer access-1"]);
  });

  it("M11: a failed refresh falls back to exactly one createSession", async () => {
    await store(net.seedSession("stale-access", "dead-refresh", { accessValid: false, refreshValid: false }));
    const result = await callTool("add_accomplishment", accomplishment);
    expect(result.isError).toBe(false);
    expect(net.callsTo("createSession")).toHaveLength(1);
    expect(net.records.size).toBe(1);
    expect((await stored())?.accessJwt).toBe("access-1");
  });

  it("logs in only once across several calls", async () => {
    await callTool("add_accomplishment", accomplishment);
    await callTool("add_accomplishment", accomplishment);
    await callTool("delete_accomplishment", { rkey: [...net.records.keys()][0]! });
    expect(net.callsTo("createSession")).toHaveLength(1);
    expect(net.callsTo("refreshSession")).toHaveLength(0);
  });

  it("refuses to write when the session belongs to a different DID", async () => {
    net.sessionDid = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
    const result = await callTool("add_accomplishment", accomplishment);
    expect(result.isError).toBe(true);
    expect(net.callsTo("createRecord")).toHaveLength(0);
    expect(net.callsTo("/dispatches")).toHaveLength(0);
  });

  it("caches the identity in KV, so a second call does not resolve it again", async () => {
    await callTool("list_accomplishments", {});
    await callTool("list_accomplishments", {});
    expect(net.callsTo("resolveHandle")).toHaveLength(1);
    expect(net.callsTo("plc.directory")).toHaveLength(1);
  });
});
