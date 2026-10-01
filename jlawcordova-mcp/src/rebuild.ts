import type { Env } from "./env.js";
import { log } from "./log.js";

export type RebuildResult = "triggered" | `failed: ${string}`;

/**
 * Asks the portfolio repo to rebuild. A failure never fails the tool, because
 * the record is already written: it is reported so the owner can run the
 * workflow by hand. The daily build catches it otherwise.
 */
export async function triggerRebuild(env: Env): Promise<RebuildResult> {
  try {
    const res = await fetch(`https://api.github.com/repos/${env.PORTFOLIO_REPO}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "jlawcordova-mcp",
        "content-type": "application/json",
      },
      body: JSON.stringify({ event_type: "atproto-updated" }),
      signal: AbortSignal.timeout(5000),
    });
    log({ event: "rebuild", status: res.status, outcome: res.status === 204 ? "triggered" : "failed" });
    return res.status === 204 ? "triggered" : `failed: HTTP ${res.status}`;
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    log({ event: "rebuild", outcome: timedOut ? "timeout" : "network_error" });
    return `failed: ${timedOut ? "timed out after 5 s" : "network error"}`;
  }
}
