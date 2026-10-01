import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import * as z from "zod";
import {
  NSID,
  compareAccomplishments,
  validateAccomplishment,
  type Accomplishment,
} from "@jlawcordova/accomplishment";
import type { Env } from "./env.js";
import { log } from "./log.js";
import { isAllowedId } from "./owner.js";
import { isRecordNotFound, resolveIdentity, withPds } from "./pds.js";
import { triggerRebuild } from "./rebuild.js";

const MAX_PAGES = 20;
const PAGE_SIZE = 100;
const DEFAULT_LIMIT = 50;
const TID = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: true };

const ok = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});
const fail = (message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/** Short description of an unexpected failure, without anything that could carry a secret. */
function describeError(error: unknown): string {
  const e = error as { status?: number; error?: string; name?: string } | null;
  if (e?.status !== undefined && e?.error) return `PDS request failed: ${e.error} (HTTP ${e.status})`;
  if (e?.status !== undefined) return `PDS request failed (HTTP ${e.status})`;
  return "Request failed. See the server logs.";
}

/**
 * Defense in depth: even behind the OAuth provider, every tool re-checks that
 * the token's GitHub ID is the owner's before touching anything.
 */
function guarded<A>(env: Env, tool: string, run: (args: A) => Promise<ToolResult>) {
  return async (args: A): Promise<ToolResult> => {
    const githubId = getMcpAuthContext()?.props?.githubId;
    if (!isAllowedId(env, githubId)) {
      log({ event: "tool", tool, outcome: "refused" });
      return fail("Not authorized.");
    }
    try {
      return await run(args);
    } catch (error) {
      log({ event: "tool", tool, outcome: "error", status: (error as { status?: number })?.status });
      return fail(describeError(error));
    }
  };
}

const rkeyOf = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);

interface ListedRecord {
  uri: string;
  cid: string;
  value: unknown;
}

async function listAll(env: Env) {
  const { did, pds } = await resolveIdentity(env);
  const records: ListedRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set("repo", did);
    url.searchParams.set("collection", NSID);
    url.searchParams.set("limit", String(PAGE_SIZE));
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw Object.assign(new Error("listRecords failed"), { status: res.status });
    const body = (await res.json()) as { records?: ListedRecord[]; cursor?: string };
    records.push(...(body.records ?? []));
    cursor = body.cursor;
    if (!cursor) break;
  }
  return records;
}

export function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "jlawcordova-mcp", version: "0.1.0" });

  server.registerTool(
    "list_accomplishments",
    {
      description:
        "Lists J. Law Cordova's public career accomplishments from the AT Protocol repo, newest first.",
      inputSchema: z.object({
        since: z
          .string()
          .optional()
          .describe("YYYY-MM. Keep accomplishments that ended (or, if they have no end, started) on or after this month."),
        limit: z.number().optional().describe(`1 to 100. Defaults to ${DEFAULT_LIMIT}.`),
      }),
      annotations: { readOnlyHint: true },
    },
    guarded(env, "list_accomplishments", async ({ since, limit }: { since?: string; limit?: number }) => {
      if (since !== undefined && !MONTH.test(since)) return fail("since must be a month as YYYY-MM.");
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
        return fail("limit must be a whole number from 1 to 100.");
      }

      const records = await listAll(env);
      let skippedInvalid = 0;
      const valid: { rkey: string; uri: string; cid: string; value: Accomplishment }[] = [];
      for (const record of records) {
        const result = validateAccomplishment(record.value);
        if (result.ok) valid.push({ rkey: rkeyOf(record.uri), uri: record.uri, cid: record.cid, value: result.value });
        else skippedInvalid++;
      }
      const matching = valid
        .filter((r) => since === undefined || (r.value.endDate ?? r.value.startDate) >= since)
        .sort((a, b) => compareAccomplishments(a.value, b.value));

      log({ event: "tool", tool: "list_accomplishments", outcome: "ok" });
      return ok({
        items: matching.slice(0, limit ?? DEFAULT_LIMIT),
        total: matching.length,
        skippedInvalid,
      });
    }),
  );

  server.registerTool(
    "add_accomplishment",
    {
      description:
        "Saves a career accomplishment as a **PUBLIC** record in J. Law Cordova's AT Protocol repo. Anyone on the internet can read it. Only call this after the user has explicitly approved the exact text of every field in this conversation. Never include confidential client names, internal project names, or non-public details.",
      inputSchema: z.object({
        title: z.string().describe("Short headline, up to 200 characters."),
        description: z.string().describe("What was done and its impact, impact first. Up to 1000 characters."),
        startDate: z.string().describe("Month it started or happened, as YYYY-MM."),
        endDate: z.string().optional().describe("Month it finished, as YYYY-MM. Omit if ongoing or a single month."),
        tags: z.array(z.string()).optional().describe("Up to 10 skills, technologies, or themes."),
        links: z.array(z.string()).optional().describe("Up to 10 http(s) links as evidence."),
      }),
    },
    guarded(
      env,
      "add_accomplishment",
      async (input: {
        title: string;
        description: string;
        startDate: string;
        endDate?: string;
        tags?: string[];
        links?: string[];
      }) => {
        const result = validateAccomplishment({
          $type: NSID,
          title: input.title,
          description: input.description,
          startDate: input.startDate,
          ...(input.endDate !== undefined && { endDate: input.endDate }),
          ...(input.tags !== undefined && { tags: input.tags }),
          ...(input.links !== undefined && { links: input.links }),
          createdAt: new Date().toISOString(),
        });
        if (!result.ok) {
          log({ event: "tool", tool: "add_accomplishment", outcome: "invalid" });
          return fail(
            `Not saved. Fix ${result.errors.length === 1 ? "this" : "these"}:\n` +
              result.errors.map((e) => `- ${e.field}: ${e.message}`).join("\n"),
          );
        }

        const created = await withPds(env, ({ agent, identity }) =>
          agent.com.atproto.repo.createRecord({
            repo: identity.did,
            collection: NSID,
            record: result.value as unknown as Record<string, unknown>,
            validate: false, // the PDS doesn't know this Lexicon
          }),
        );
        const rkey = rkeyOf(created.data.uri);
        log({ event: "tool", tool: "add_accomplishment", outcome: "ok", rkey });
        const rebuild = await triggerRebuild(env);
        return ok({ rkey, uri: created.data.uri, cid: created.data.cid, record: result.value, rebuild });
      },
    ),
  );

  server.registerTool(
    "delete_accomplishment",
    {
      description:
        "Deletes one accomplishment from J. Law Cordova's AT Protocol repo by its record key (rkey), as returned by list_accomplishments. Deleting is permanent.",
      inputSchema: z.object({ rkey: z.string().describe("Record key (a 13-character TID).") }),
      annotations: { destructiveHint: true },
    },
    guarded(env, "delete_accomplishment", async ({ rkey }: { rkey: string }) => {
      if (!TID.test(rkey)) return fail("rkey must be a valid record key (a 13-character TID).");

      const deleted = await withPds(env, async ({ agent, identity }) => {
        let existing;
        try {
          existing = await agent.com.atproto.repo.getRecord({ repo: identity.did, collection: NSID, rkey });
        } catch (error) {
          if (isRecordNotFound(error)) return null;
          throw error;
        }
        await agent.com.atproto.repo.deleteRecord({ repo: identity.did, collection: NSID, rkey });
        const value = existing.data.value as { title?: unknown; startDate?: unknown };
        return { title: value.title, startDate: value.startDate };
      });
      if (!deleted) {
        log({ event: "tool", tool: "delete_accomplishment", outcome: "not_found", rkey });
        return fail(`Not found: no accomplishment with rkey ${rkey}.`);
      }

      log({ event: "tool", tool: "delete_accomplishment", outcome: "ok", rkey });
      const rebuild = await triggerRebuild(env);
      return ok({ rkey, deleted, rebuild });
    }),
  );

  return server;
}
