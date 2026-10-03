import {
  NSID,
  compareAccomplishments,
  validateAccomplishment,
  type Accomplishment,
  type ValidationError,
} from "@jlawcordova/accomplishment";
import type { Env } from "./env.js";
import { isInvalidSwap, isRecordNotFound, resolveIdentity, withPds } from "./pds.js";
import { triggerRebuild, type RebuildResult } from "./rebuild.js";

/**
 * The three operations behind both the MCP tools and the HTTP API. They check
 * their input, talk to the PDS, and return a result. Unexpected failures (the
 * PDS erroring, say) are thrown, and each caller turns them into its own error.
 */

const MAX_PAGES = 20;
const PAGE_SIZE = 100;
const DEFAULT_LIMIT = 50;
const TID = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** The fields a caller may set on add or update. `createdAt` and `$type` are the Worker's. */
export const ADD_FIELDS = new Set([
  "title", "description", "funTitle", "shortDescription", "icon", "done", "startDate", "endDate", "tags", "links",
]);
// Set by the Worker, so a caller sending them is ignored rather than refused.
const IGNORED_FIELDS = new Set(["createdAt", "$type"]);

export type Failure =
  | { ok: false; kind: "bad_request"; message: string }
  | { ok: false; kind: "invalid"; errors: ValidationError[] }
  | { ok: false; kind: "not_found"; message: string }
  | { ok: false; kind: "conflict"; message: string };

export type Result<T> = { ok: true; value: T } | Failure;

export interface AddInput {
  title: string;
  description: string;
  funTitle: string;
  shortDescription: string;
  icon: string;
  done?: boolean;
  startDate?: string;
  endDate?: string;
  tags?: string[];
  links?: string[];
}

export interface ListedAccomplishment {
  rkey: string;
  uri: string;
  cid: string;
  value: Accomplishment;
}

export interface ListValue {
  items: ListedAccomplishment[];
  total: number;
  skippedInvalid: number;
}

export interface AddValue {
  rkey: string;
  uri: string;
  cid: string;
  record: Accomplishment;
  rebuild: RebuildResult;
}

export interface UpdateValue {
  rkey: string;
  uri: string;
  cid: string;
  record: Accomplishment;
  rebuild: RebuildResult;
}

export interface DeleteValue {
  rkey: string;
  deleted: { title: unknown; startDate: unknown };
  rebuild: RebuildResult;
}

/** Short description of an unexpected failure, without anything that could carry a secret. */
export function describeError(error: unknown): string {
  const e = error as { status?: number; error?: string; name?: string } | null;
  if (e?.status !== undefined && e?.error) return `PDS request failed: ${e.error} (HTTP ${e.status})`;
  if (e?.status !== undefined) return `PDS request failed (HTTP ${e.status})`;
  return "Request failed. See the server logs.";
}

export const rkeyOf = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);

interface RawRecord {
  uri: string;
  cid: string;
  value: unknown;
}

async function listAll(env: Env) {
  const { did, pds } = await resolveIdentity(env);
  const records: RawRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set("repo", did);
    url.searchParams.set("collection", NSID);
    url.searchParams.set("limit", String(PAGE_SIZE));
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw Object.assign(new Error("listRecords failed"), { status: res.status });
    const body = (await res.json()) as { records?: RawRecord[]; cursor?: string };
    records.push(...(body.records ?? []));
    cursor = body.cursor;
    if (!cursor) break;
  }
  return records;
}

export async function listAccomplishments(
  env: Env,
  { since, limit }: { since?: string; limit?: number },
): Promise<Result<ListValue>> {
  if (since !== undefined && !MONTH.test(since)) {
    return { ok: false, kind: "bad_request", message: "since must be a month as YYYY-MM." };
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    return { ok: false, kind: "bad_request", message: "limit must be a whole number from 1 to 100." };
  }

  const records = await listAll(env);
  let skippedInvalid = 0;
  const valid: ListedAccomplishment[] = [];
  for (const record of records) {
    const result = validateAccomplishment(record.value);
    if (result.ok) valid.push({ rkey: rkeyOf(record.uri), uri: record.uri, cid: record.cid, value: result.value });
    else skippedInvalid++;
  }
  const matching = valid
    // Locked records have no dates, so a month filter never hides them.
    .filter((r) => since === undefined || r.value.done === false || (r.value.endDate ?? r.value.startDate ?? "") >= since)
    .sort((a, b) => compareAccomplishments(a.value, b.value));

  return { ok: true, value: { items: matching.slice(0, limit ?? DEFAULT_LIMIT), total: matching.length, skippedInvalid } };
}

export async function addAccomplishment(env: Env, input: AddInput): Promise<Result<AddValue>> {
  const result = validateAccomplishment(
    {
      $type: NSID,
      title: input.title,
      description: input.description,
      funTitle: input.funTitle,
      shortDescription: input.shortDescription,
      icon: input.icon,
      ...(input.done !== undefined && { done: input.done }),
      ...(input.startDate !== undefined && { startDate: input.startDate }),
      ...(input.endDate !== undefined && { endDate: input.endDate }),
      ...(input.tags !== undefined && { tags: input.tags }),
      ...(input.links !== undefined && { links: input.links }),
      createdAt: new Date().toISOString(),
    },
    { mode: "write" },
  );
  if (!result.ok) return { ok: false, kind: "invalid", errors: result.errors };

  const created = await withPds(env, ({ agent, identity }) =>
    agent.com.atproto.repo.createRecord({
      repo: identity.did,
      collection: NSID,
      record: result.value as unknown as Record<string, unknown>,
      validate: false, // the PDS doesn't know this Lexicon
    }),
  );
  const rebuild = await triggerRebuild(env);
  return {
    ok: true,
    value: { rkey: rkeyOf(created.data.uri), uri: created.data.uri, cid: created.data.cid, record: result.value, rebuild },
  };
}

/**
 * Changes a record in place. Every field the patch doesn't name stays as
 * stored, `null` removes a field, and `createdAt` never changes. `swapRecord`
 * makes a concurrent change fail with `conflict` instead of being overwritten.
 */
export async function updateAccomplishment(
  env: Env,
  rkey: string,
  patch: Record<string, unknown>,
): Promise<Result<UpdateValue>> {
  if (!TID.test(rkey)) {
    return { ok: false, kind: "bad_request", message: "rkey must be a valid record key (a 13-character TID)." };
  }
  if (typeof patch !== "object" || patch === null || Array.isArray(patch) || Object.keys(patch).length === 0) {
    return { ok: false, kind: "bad_request", message: "Nothing to update." };
  }
  const unknown = Object.keys(patch).filter((k) => !ADD_FIELDS.has(k) && !IGNORED_FIELDS.has(k));
  if (unknown.length > 0) {
    return { ok: false, kind: "invalid", errors: unknown.map((field) => ({ field, message: "is not a known field" })) };
  }

  const updated = await withPds(env, async ({ agent, identity }): Promise<Result<Omit<UpdateValue, "rebuild">>> => {
    let existing;
    try {
      existing = await agent.com.atproto.repo.getRecord({ repo: identity.did, collection: NSID, rkey });
    } catch (error) {
      if (isRecordNotFound(error)) return { ok: false, kind: "not_found", message: `Not found: no accomplishment with rkey ${rkey}.` };
      throw error;
    }

    const merged: Record<string, unknown> = { ...(existing.data.value as Record<string, unknown>) };
    for (const [field, value] of Object.entries(patch)) {
      if (IGNORED_FIELDS.has(field)) continue;
      if (value === null) delete merged[field];
      else merged[field] = value;
    }
    const result = validateAccomplishment(merged, { mode: "write" });
    if (!result.ok) return { ok: false, kind: "invalid", errors: result.errors };

    let put;
    try {
      put = await agent.com.atproto.repo.putRecord({
        repo: identity.did,
        collection: NSID,
        rkey,
        record: result.value as unknown as Record<string, unknown>,
        swapRecord: existing.data.cid,
        validate: false, // the PDS doesn't know this Lexicon
      });
    } catch (error) {
      if (isInvalidSwap(error)) {
        return { ok: false, kind: "conflict", message: "The record changed while updating. Try again." };
      }
      throw error;
    }
    return { ok: true, value: { rkey, uri: put.data.uri, cid: put.data.cid, record: result.value } };
  });
  if (!updated.ok) return updated;

  const rebuild = await triggerRebuild(env);
  return { ok: true, value: { ...updated.value, rebuild } };
}

export async function deleteAccomplishment(env: Env, rkey: string): Promise<Result<DeleteValue>> {
  if (!TID.test(rkey)) {
    return { ok: false, kind: "bad_request", message: "rkey must be a valid record key (a 13-character TID)." };
  }

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
  if (!deleted) return { ok: false, kind: "not_found", message: `Not found: no accomplishment with rkey ${rkey}.` };

  const rebuild = await triggerRebuild(env);
  return { ok: true, value: { rkey, deleted, rebuild } };
}
