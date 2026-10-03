import {
  addAccomplishment,
  deleteAccomplishment,
  describeError,
  listAccomplishments,
  type Failure,
} from "./accomplishments.js";
import type { Env } from "./env.js";
import { log } from "./log.js";
import { isOwner } from "./owner.js";

/**
 * The HTTP API the CLI calls. Every request carries a GitHub OAuth App token,
 * which is checked against this Worker's own app before anything else runs.
 */

const MAX_BODY_BYTES = 64 * 1024;
const CHECK_TIMEOUT_MS = 5000;
const TOKEN_FORMAT = /^gho_[A-Za-z0-9_]{20,255}$/;
const COLLECTION = "/api/accomplishments";
const ADD_FIELDS = new Set(["title", "description", "funTitle", "shortDescription", "icon", "done", "startDate", "endDate", "tags", "links"]);
// Set by the Worker, so a caller sending them is ignored rather than refused.
const IGNORED_FIELDS = new Set(["createdAt", "$type"]);

type Route = "list" | "add" | "delete" | "unknown";

function respond(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

const error = (status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers = {}) =>
  respond(status, { error: code, message, ...extra }, headers);

type Verdict =
  | { ok: true }
  | { ok: false; response: Response; outcome: string };

/**
 * Asks GitHub whether the token was issued to this Worker's OAuth App, and for
 * whom. `GET /user` is not used: it would accept a token for the owner from any
 * app, such as a third-party site the owner signed in to with GitHub.
 */
async function verify(request: Request, env: Env): Promise<Verdict> {
  const unauthorized = (): Verdict => ({
    ok: false,
    outcome: "unauthorized",
    response: error(401, "unauthorized", "Missing or invalid token. Run `accomplishments login`."),
  });

  const token = /^Bearer (\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token || !TOKEN_FORMAT.test(token)) return unauthorized();

  const unavailable = (): Verdict => ({
    ok: false,
    outcome: "auth_unavailable",
    response: error(503, "auth_unavailable", "Couldn't check the token with GitHub. Try again."),
  });

  let res: Response;
  try {
    res = await fetch(`https://api.github.com/applications/${encodeURIComponent(env.GITHUB_CLIENT_ID)}/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "jlawcordova-mcp",
        "content-type": "application/json",
      },
      body: JSON.stringify({ access_token: token }),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
  } catch {
    return unavailable();
  }
  if (res.status === 404 || res.status === 422) return unauthorized();
  if (res.status !== 200) return unavailable();

  let user: { id?: unknown; login?: unknown } | undefined;
  try {
    user = ((await res.json()) as { user?: { id?: unknown; login?: unknown } }).user;
  } catch {
    return unavailable();
  }
  if (!user) return unavailable();

  if (!isOwner(env, user)) {
    return {
      ok: false,
      outcome: "forbidden",
      response: error(403, "forbidden", "This GitHub account isn't allowed to use the accomplishments API."),
    };
  }
  return { ok: true };
}

function failure(f: Failure): Response {
  if (f.kind === "invalid") return error(422, "invalid", "The record failed validation.", { errors: f.errors });
  return error(f.kind === "not_found" ? 404 : 400, f.kind, f.message);
}

async function readJsonObject(request: Request): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length"));
  const tooLarge = () => ({ ok: false as const, response: error(413, "too_large", "The body is over 64 KiB.") });
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return tooLarge();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, response: error(400, "bad_request", "The body must be a JSON object.") };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, response: error(400, "bad_request", "The body must be a JSON object.") };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

interface Handled {
  response: Response;
  route: Route;
  outcome: string;
  rkey?: string;
}

async function dispatch(request: Request, env: Env): Promise<Handled> {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  if (path === COLLECTION) {
    if (method === "GET") {
      const rawLimit = url.searchParams.get("limit");
      const result = await listAccomplishments(env, {
        since: url.searchParams.get("since") ?? undefined,
        limit: rawLimit === null ? undefined : Number(rawLimit),
      });
      if (!result.ok) return { route: "list", outcome: result.kind, response: failure(result) };
      return { route: "list", outcome: "ok", response: respond(200, result.value) };
    }

    if (method === "POST") {
      const body = await readJsonObject(request);
      if (!body.ok) return { route: "add", outcome: "rejected", response: body.response };

      const unknown = Object.keys(body.value).filter((k) => !ADD_FIELDS.has(k) && !IGNORED_FIELDS.has(k));
      if (unknown.length > 0) {
        const errors = unknown.map((field) => ({ field, message: "is not a known field" }));
        return { route: "add", outcome: "invalid", response: failure({ ok: false, kind: "invalid", errors }) };
      }

      const result = await addAccomplishment(env, body.value as never);
      if (!result.ok) return { route: "add", outcome: result.kind, response: failure(result) };
      return { route: "add", outcome: "ok", rkey: result.value.rkey, response: respond(201, result.value) };
    }

    return {
      route: "unknown",
      outcome: "method_not_allowed",
      response: error(405, "method_not_allowed", "Use GET or POST.", {}, { allow: "GET, POST" }),
    };
  }

  if (path.startsWith(`${COLLECTION}/`)) {
    const segment = path.slice(COLLECTION.length + 1);
    if (segment === "" || segment.includes("/")) {
      return { route: "unknown", outcome: "not_found", response: error(404, "not_found", "No such route.") };
    }
    if (method !== "DELETE") {
      return {
        route: "unknown",
        outcome: "method_not_allowed",
        response: error(405, "method_not_allowed", "Use DELETE.", {}, { allow: "DELETE" }),
      };
    }

    let rkey: string;
    try {
      rkey = decodeURIComponent(segment);
    } catch {
      return {
        route: "delete",
        outcome: "bad_request",
        response: failure({ ok: false, kind: "bad_request", message: "rkey must be a valid record key (a 13-character TID)." }),
      };
    }
    const result = await deleteAccomplishment(env, rkey);
    if (!result.ok) return { route: "delete", outcome: result.kind, rkey, response: failure(result) };
    return { route: "delete", outcome: "ok", rkey, response: respond(200, result.value) };
  }

  return { route: "unknown", outcome: "not_found", response: error(404, "not_found", "No such route.") };
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const method = request.method;
  const verdict = await verify(request, env);
  if (!verdict.ok) {
    log({ event: "api", route: "auth", method, status: verdict.response.status, outcome: verdict.outcome });
    return verdict.response;
  }

  let handled: Handled;
  try {
    handled = await dispatch(request, env);
  } catch (e) {
    log({ event: "api", route: "error", method, status: 502, outcome: "error" });
    return error(502, "upstream", describeError(e));
  }
  log({
    event: "api",
    route: handled.route,
    method,
    status: handled.response.status,
    outcome: handled.outcome,
    ...(handled.rkey !== undefined && { rkey: handled.rkey }),
  });
  return handled.response;
}
