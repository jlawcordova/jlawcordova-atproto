import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import * as z from "zod";
import {
  addAccomplishment,
  deleteAccomplishment,
  describeError,
  listAccomplishments,
  type AddInput,
  type Failure,
} from "./accomplishments.js";
import type { Env } from "./env.js";
import { log } from "./log.js";
import { isAllowedId } from "./owner.js";

const DEFAULT_LIMIT = 50;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: true };

const ok = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});
const fail = (message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

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

/** The text an MCP client sees for an operation that was refused. */
function failureText(failure: Failure): string {
  if (failure.kind !== "invalid") return failure.message;
  return (
    `Not saved. Fix ${failure.errors.length === 1 ? "this" : "these"}:\n` +
    failure.errors.map((e) => `- ${e.field}: ${e.message}`).join("\n")
  );
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
    guarded(env, "list_accomplishments", async (args: { since?: string; limit?: number }) => {
      const result = await listAccomplishments(env, args);
      if (!result.ok) return fail(failureText(result));
      log({ event: "tool", tool: "list_accomplishments", outcome: "ok" });
      return ok(result.value);
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
        funTitle: z.string().describe("Playful name for the achievement list, one to three words."),
        shortDescription: z.string().describe("A line under the fun title, five to seven words."),
        icon: z.string().describe("Icon ID in lowercase kebab-case, such as sprout, rocket or trophy."),
        done: z.boolean().optional().describe("False saves a locked goal that has no dates. Defaults to true."),
        startDate: z
          .string()
          .optional()
          .describe("Month it started or happened, as YYYY-MM. Required unless done is false, when it must be omitted."),
        endDate: z.string().optional().describe("Month it finished, as YYYY-MM. Omit if ongoing, a single month or locked."),
        tags: z.array(z.string()).optional().describe("Up to 10 skills, technologies, or themes."),
        links: z.array(z.string()).optional().describe("Up to 10 http(s) links as evidence."),
      }),
    },
    guarded(env, "add_accomplishment", async (input: AddInput) => {
      const result = await addAccomplishment(env, input);
      if (!result.ok) {
        log({ event: "tool", tool: "add_accomplishment", outcome: "invalid" });
        return fail(failureText(result));
      }
      log({ event: "tool", tool: "add_accomplishment", outcome: "ok", rkey: result.value.rkey });
      return ok(result.value);
    }),
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
      const result = await deleteAccomplishment(env, rkey);
      if (!result.ok) {
        if (result.kind === "not_found") log({ event: "tool", tool: "delete_accomplishment", outcome: "not_found", rkey });
        return fail(failureText(result));
      }
      log({ event: "tool", tool: "delete_accomplishment", outcome: "ok", rkey });
      return ok(result.value);
    }),
  );

  return server;
}
