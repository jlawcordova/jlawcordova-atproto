import { describe, expect, it } from "vitest";
import { callTool, OWNER } from "./call-tool.js";
import { DID, NSID, tid, useFakeNetwork } from "./fake-network.js";

const { net } = useFakeNetwork();

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

describe("authorization of tool calls", () => {
  it("M4: a token for a different GitHub ID is refused before any PDS call", async () => {
    for (const props of [{ githubId: 1, login: "jlawcordova" }, { login: "jlawcordova" }, {}]) {
      for (const [tool, args] of [
        ["add_accomplishment", valid],
        ["delete_accomplishment", { rkey: tid(1) }],
        ["list_accomplishments", {}],
      ] as const) {
        const result = await callTool(tool, args, props);
        expect(result.isError).toBe(true);
        expect(result.text).toBe("Not authorized.");
      }
    }
    expect(net.calls).toEqual([]);
  });
});

describe("add_accomplishment", () => {
  it("M5: an invalid record returns every error and writes nothing", async () => {
    const result = await callTool("add_accomplishment", {
      ...valid,
      title: "   ",
      startDate: "2026-13",
      links: ["javascript:alert(1)"],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("- title: must not be empty");
    expect(result.text).toContain("- startDate:");
    expect(result.text).toContain("- links[0]:");
    expect(net.callsTo("createRecord")).toHaveLength(0);
    expect(net.callsTo("/dispatches")).toHaveLength(0);
    expect(net.callsTo("createSession")).toHaveLength(0);
  });

  it("M6: a valid record is created once, then one rebuild is dispatched", async () => {
    const result = await callTool("add_accomplishment", valid);
    expect(result.isError).toBe(false);

    const creates = net.callsTo("createRecord");
    expect(creates).toHaveLength(1);
    const body = JSON.parse(creates[0]!.body);
    expect(body).toMatchObject({ repo: DID, collection: NSID, validate: false });
    expect(body.record).toMatchObject({ $type: NSID, ...valid });
    expect(body.record.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(creates[0]!.headers.get("authorization")).toMatch(/^Bearer /);

    const dispatches = net.callsTo("/dispatches");
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.url.pathname).toBe("/repos/jlawcordova/jlawcordova.github.io/dispatches");
    expect(dispatches[0]!.method).toBe("POST");
    expect(JSON.parse(dispatches[0]!.body)).toEqual({ event_type: "atproto-updated" });
    expect(dispatches[0]!.headers.get("authorization")).toBe("Bearer test-dispatch-token-SECRET");
    expect(dispatches[0]!.headers.get("user-agent")).toBe("jlawcordova-mcp");

    const out = result.json();
    expect(out.rkey).toBe(tid(0));
    expect(out.uri).toBe(`at://${DID}/${NSID}/${tid(0)}`);
    expect(out.cid).toBeTruthy();
    expect(out.record).toMatchObject(valid);
    expect(out.rebuild).toBe("triggered");
  });

  it("M7: a failed dispatch does not fail the tool", async () => {
    net.dispatchStatus = 500;
    const result = await callTool("add_accomplishment", valid);
    expect(result.isError).toBe(false);
    expect(result.json().rebuild).toBe("failed: HTTP 500");
    expect(net.records.size).toBe(1);
  });

  it("M7: a dispatch timeout is reported, not thrown", async () => {
    net.dispatchThrows = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const result = await callTool("add_accomplishment", valid);
    expect(result.isError).toBe(false);
    expect(result.json().rebuild).toMatch(/^failed: timed out/);
  });
});

describe("add_accomplishment gamified fields", () => {
  it("U11: saves funTitle, shortDescription, icon and done, and returns them", async () => {
    const { startDate: _, endDate: __, ...goal } = valid;
    const result = await callTool("add_accomplishment", { ...goal, done: false });
    expect(result.isError).toBe(false);
    const body = JSON.parse(net.callsTo("createRecord")[0]!.body);
    expect(body.record).toMatchObject({ funTitle: "Speed Demon", shortDescription: "Deploys now finish in six minutes", icon: "rocket", done: false });
    expect(body.record).not.toHaveProperty("startDate");
    expect(result.json().record).toMatchObject({ icon: "rocket", done: false });
  });

  it("U11: the three new fields are required, with their word counts", async () => {
    const { funTitle: _, ...noTitle } = valid;
    expect((await callTool("add_accomplishment", noTitle)).isError).toBe(true); // refused by the input schema

    const long = await callTool("add_accomplishment", { ...valid, funTitle: "One two three four", shortDescription: "Too short", icon: "" });
    expect(long.text).toContain("- funTitle: must be one to three words");
    expect(long.text).toContain("- shortDescription: must be five to seven words");
    expect(long.text).toContain("- icon: is required");
    expect(net.callsTo("createRecord")).toHaveLength(0);
  });
});

describe("delete_accomplishment", () => {
  it("M8: a malformed rkey is rejected without touching the network", async () => {
    for (const rkey of ["nope", "../etc", tid(1).toUpperCase(), `${tid(1)}x`]) {
      const result = await callTool("delete_accomplishment", { rkey });
      expect(result.isError).toBe(true);
    }
    expect(net.calls).toEqual([]);
  });

  it("M8: a missing record is 'not found', with no delete and no dispatch", async () => {
    const result = await callTool("delete_accomplishment", { rkey: tid(7) });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Not found");
    expect(net.callsTo("deleteRecord")).toHaveLength(0);
    expect(net.callsTo("/dispatches")).toHaveLength(0);
  });

  it("deletes an existing record, then dispatches once", async () => {
    const rkey = net.addRecord(stored({ title: "Old win", startDate: "2025-04" }));
    const result = await callTool("delete_accomplishment", { rkey });
    expect(result.isError).toBe(false);
    expect(result.json()).toEqual({
      rkey,
      deleted: { title: "Old win", startDate: "2025-04" },
      rebuild: "triggered",
    });
    const deletes = net.callsTo("deleteRecord");
    expect(deletes).toHaveLength(1);
    expect(JSON.parse(deletes[0]!.body)).toEqual({ repo: DID, collection: NSID, rkey });
    expect(net.records.has(rkey)).toBe(false);
    expect(net.callsTo("/dispatches")).toHaveLength(1);
  });
});

describe("list_accomplishments", () => {
  it("M12: follows the cursor, applies since, sorts, cuts to limit, and counts invalid records", async () => {
    net.pageSize = 2;
    net.addRecord(stored({ title: "A", startDate: "2024-01" }));
    net.addRecord(stored({ title: "B", startDate: "2026-02" }));
    net.addRecord(stored({ title: "C", startDate: "2020-01", endDate: "2026-06" }));
    net.addRecord({ title: "broken" }); // fails validation
    net.addRecord(stored({ title: "D", startDate: "2025-05", createdAt: "2026-03-01T00:00:00.000Z" }));
    net.addRecord(stored({ title: "E", startDate: "2025-05", createdAt: "2026-04-01T00:00:00.000Z" }));

    const all = (await callTool("list_accomplishments", {})).json();
    expect(all.items.map((i: { value: { title: string } }) => i.value.title)).toEqual(["C", "B", "E", "D", "A"]);
    expect(all.total).toBe(5);
    expect(all.skippedInvalid).toBe(1);
    expect(all.items[0]).toMatchObject({ rkey: tid(2), uri: `at://${DID}/${NSID}/${tid(2)}` });
    expect(all.items[0].cid).toBeTruthy();
    expect(net.callsTo("listRecords")).toHaveLength(3);

    const since = (await callTool("list_accomplishments", { since: "2025-06" })).json();
    expect(since.items.map((i: { value: { title: string } }) => i.value.title)).toEqual(["C", "B"]);
    expect(since.total).toBe(2);

    const limited = (await callTool("list_accomplishments", { limit: 2 })).json();
    expect(limited.items).toHaveLength(2);
    expect(limited.total).toBe(5);
  });

  it("V10: since keeps every locked record, which has no dates", async () => {
    net.addRecord(stored({ title: "Old", startDate: "2020-01" }));
    net.addRecord(stored({ title: "Goal", startDate: undefined, done: false }));
    net.addRecord(stored({ title: "Recent", startDate: "2026-05" }));
    const since = (await callTool("list_accomplishments", { since: "2026-01" })).json();
    expect(since.items.map((i: { value: { title: string } }) => i.value.title)).toEqual(["Goal", "Recent"]);
    expect(since.total).toBe(2);
    const limited = (await callTool("list_accomplishments", { limit: 1 })).json();
    expect(limited.items[0].value.title).toBe("Goal");
  });

  it("reads without authenticating to the PDS", async () => {
    net.addRecord(stored());
    await callTool("list_accomplishments", {});
    expect(net.callsTo("createSession")).toHaveLength(0);
    for (const call of net.callsTo("listRecords")) expect(call.headers.get("authorization")).toBeNull();
    const url = net.callsTo("listRecords")[0]!.url;
    expect(url.searchParams.get("repo")).toBe(DID);
    expect(url.searchParams.get("collection")).toBe(NSID);
    expect(url.searchParams.get("limit")).toBe("100");
  });

  it("rejects a malformed since or limit", async () => {
    expect((await callTool("list_accomplishments", { since: "2026-13" })).isError).toBe(true);
    expect((await callTool("list_accomplishments", { limit: 0 })).isError).toBe(true);
    expect((await callTool("list_accomplishments", { limit: 101 })).isError).toBe(true);
    expect(net.calls).toEqual([]);
  });

  it("stops after 20 pages", async () => {
    net.pageSize = 1;
    for (let i = 0; i < 25; i++) net.addRecord(stored({ title: `T${i}` }));
    const out = (await callTool("list_accomplishments", { limit: 100 })).json();
    expect(net.callsTo("listRecords")).toHaveLength(20);
    expect(out.total).toBe(20);
  });
});

describe("M13: logs", () => {
  it("record text, tokens, and secrets never reach the logs", async () => {
    await callTool("add_accomplishment", valid);
    await callTool("add_accomplishment", { ...valid, title: "" });
    const rkey = [...net.records.keys()][0]!;
    await callTool("list_accomplishments", {});
    await callTool("delete_accomplishment", { rkey });
    await callTool("add_accomplishment", valid, { githubId: 5 });
    expect(net.logs.length).toBeGreaterThan(0);
    // useFakeNetwork's afterEach asserts the contents.
  });
});

void OWNER;
