import lexiconJson from "../../lexicons/com/jlawcordova/profile/accomplishment.json" with { type: "json" };
import { Lexicons } from "@atproto/lexicon";

export const NSID = "com.jlawcordova.profile.accomplishment";

/** The Lexicon document, imported from `lexicons/`, the single source of truth for the schema. */
export const lexicon = lexiconJson;

export interface Accomplishment {
  $type?: typeof NSID;
  title: string;
  description: string;
  funTitle?: string;
  shortDescription?: string;
  icon?: string;
  /** False marks a locked accomplishment (a goal not reached yet). Absent means done. */
  done?: boolean;
  startDate?: string; // YYYY-MM, absent only while locked
  endDate?: string; // YYYY-MM
  tags?: string[];
  links?: string[];
  createdAt: string; // RFC 3339
}

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; value: Accomplishment }
  | { ok: false; errors: ValidationError[] };

const lexicons = new Lexicons([lexiconJson as never]);

const recordDef = lexiconJson.defs.main.record;
const PROPERTIES = Object.keys(recordDef.properties);
const REQUIRED: readonly string[] = recordDef.required;

// Known-good values, so each property can be checked against the Lexicon on
// its own and every problem is reported at once, not just the first.
const BASELINE: Record<string, unknown> = {
  $type: NSID,
  title: "x",
  description: "x",
  startDate: "2000-01",
  createdAt: "2000-01-01T00:00:00Z",
};

/** `read` accepts every record stored so far; `write` also requires the gamified fields. */
export interface ValidateOptions {
  mode?: "read" | "write";
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MIN_YEAR = 1970;
const MAX_YEAR = 2100;
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = MONTH.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

function wordCount(value: string): number {
  const text = value.trim();
  return text === "" ? 0 : text.split(/\s+/).length;
}

function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** `Record/links/2 must be a uri` → `{ field: "links[2]", message: "must be a uri" }`. */
function fromLexiconMessage(raw: string): ValidationError {
  const missing = /^Record must have the property "(.+)"$/.exec(raw);
  if (missing) return { field: missing[1]!, message: "is required" };
  const match = /^Record\/(\S+) (.*)$/.exec(raw);
  if (!match) return { field: "record", message: raw };
  const field = match[1]!.replace(/\/(\d+)/g, "[$1]").replace(/\//g, ".");
  return { field, message: match[2]! };
}

function trimmed(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

function checkSchema(record: Record<string, unknown>, errors: ValidationError[]): void {
  for (const key of REQUIRED) {
    if (record[key] === undefined) errors.push({ field: key, message: "is required" });
  }
  for (const key of PROPERTIES) {
    if (record[key] === undefined) continue;
    try {
      lexicons.assertValidRecord(NSID, { ...BASELINE, [key]: record[key] });
    } catch (e) {
      errors.push(fromLexiconMessage(e instanceof Error ? e.message : String(e)));
    }
  }
}

function checkExtraRules(record: Record<string, unknown>, mode: "read" | "write", errors: ValidationError[]): void {
  const { title, description, startDate, endDate, tags, links, icon, done } = record;

  for (const [field, value] of [["title", title], ["description", description]] as const) {
    if (typeof value === "string" && value === "") {
      errors.push({ field, message: "must not be empty" });
    }
  }

  if (done !== undefined && typeof done !== "boolean") {
    errors.push({ field: "done", message: "must be a boolean" });
  }
  if (typeof icon === "string" && icon !== "" && !KEBAB_CASE.test(icon)) {
    errors.push({ field: "icon", message: "must be lowercase kebab-case" });
  }

  // A locked record is a goal not reached yet, so it has no dates.
  if (done === false) {
    for (const field of ["startDate", "endDate"] as const) {
      if (record[field] !== undefined) errors.push({ field, message: "must be absent while done is false" });
    }
  } else if (startDate === undefined) {
    errors.push({ field: "startDate", message: "is required unless done is false" });
  }

  if (mode === "write") {
    for (const [field, min, max, message] of [
      ["funTitle", 1, 3, "must be one to three words"],
      ["shortDescription", 5, 7, "must be five to seven words"],
    ] as const) {
      const value = record[field];
      if (value === undefined || value === "") {
        errors.push({ field, message: "is required" });
      } else if (typeof value === "string") {
        const words = wordCount(value);
        if (words < min || words > max) errors.push({ field, message });
      }
    }
    if (icon === undefined || icon === "") errors.push({ field: "icon", message: "is required" });
  }

  const startOk = isMonth(startDate);
  const endOk = isMonth(endDate);
  if (typeof startDate === "string" && !startOk) {
    errors.push({ field: "startDate", message: `must be a month as YYYY-MM between ${MIN_YEAR}-01 and ${MAX_YEAR}-12` });
  }
  if (typeof endDate === "string" && !endOk) {
    errors.push({ field: "endDate", message: `must be a month as YYYY-MM between ${MIN_YEAR}-01 and ${MAX_YEAR}-12` });
  }
  if (startOk && endOk && endDate! < startDate!) {
    errors.push({ field: "endDate", message: "must not be before startDate" });
  }

  if (Array.isArray(tags)) {
    const seen = new Map<string, number>();
    tags.forEach((tag, i) => {
      if (typeof tag !== "string") return;
      if (tag === "") {
        errors.push({ field: `tags[${i}]`, message: "must not be empty" });
        return;
      }
      const key = tag.toLowerCase();
      const first = seen.get(key);
      if (first === undefined) seen.set(key, i);
      else errors.push({ field: `tags[${i}]`, message: `duplicates tags[${first}] (ignoring case)` });
    });
  }

  if (Array.isArray(links)) {
    links.forEach((link, i) => {
      if (typeof link === "string" && !isHttpUrl(link)) {
        errors.push({ field: `links[${i}]`, message: "must be an absolute http or https URL" });
      }
    });
  }
}

/**
 * Validates an accomplishment record against the Lexicon plus the rules the
 * Lexicon can't express. Returns the value as given, apart from trimming
 * `title`, `description`, `funTitle`, `shortDescription` and tags. `createdAt`
 * must already be set. Write mode is for new and changed records; read mode
 * keeps every record stored so far valid.
 */
export function validateAccomplishment(input: unknown, { mode = "read" }: ValidateOptions = {}): ValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: [{ field: "record", message: "must be an object" }] };
  }

  const record: Record<string, unknown> = { ...input };
  record.title = trimmed(record.title);
  record.description = trimmed(record.description);
  record.funTitle = trimmed(record.funTitle);
  record.shortDescription = trimmed(record.shortDescription);
  if (Array.isArray(record.tags)) record.tags = record.tags.map(trimmed);
  for (const key of PROPERTIES) if (record[key] === undefined) delete record[key];

  const errors: ValidationError[] = [];
  if (record.$type !== undefined && record.$type !== NSID) {
    errors.push({ field: "$type", message: `must be ${NSID}` });
  }

  // Extra rules first: their messages are more specific than the Lexicon's
  // (e.g. "must be YYYY-MM" over "must not be shorter than 7 characters").
  checkExtraRules(record, mode, errors);
  const extraFields = new Set(errors.map((e) => e.field));
  const lexiconErrors: ValidationError[] = [];
  checkSchema(record, lexiconErrors);
  for (const err of lexiconErrors) if (!extraFields.has(err.field)) errors.push(err);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: record as unknown as Accomplishment };
}

const isLocked = (a: Accomplishment) => a.done === false;

function sortKey(a: Accomplishment): string {
  return a.endDate ?? a.startDate ?? "";
}

function createdAtMillis(value: string): number {
  return Date.parse(value);
}

function compareCreatedAt(a: Accomplishment, b: Accomplishment): number {
  const ta = createdAtMillis(a.createdAt);
  const tb = createdAtMillis(b.createdAt);
  if (!Number.isNaN(ta) && !Number.isNaN(tb)) return tb - ta;
  return a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1;
}

/**
 * Locked records first, newest `createdAt` first, so a limit never cuts them
 * off. Then done records, newest first: `endDate ?? startDate` descending,
 * then `createdAt` descending.
 */
export function compareAccomplishments(a: Accomplishment, b: Accomplishment): number {
  if (isLocked(a) !== isLocked(b)) return isLocked(a) ? -1 : 1;
  if (isLocked(a)) return compareCreatedAt(a, b);
  const ka = sortKey(a);
  const kb = sortKey(b);
  if (ka !== kb) return ka < kb ? 1 : -1;
  return compareCreatedAt(a, b);
}
