// @ts-check
// Temporary one-off: adds funTitle, shortDescription and icon to existing
// accomplishment records. Deleted after the run. See
// docs/intents/2026-10-gamified-accomplishments/spec.md section 7.
//
// Usage: node scripts/migrate-gamified-accomplishments.mjs <approved.json> [--write]
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const FIELDS = ["funTitle", "shortDescription", "icon"];
const USAGE = "Usage: node scripts/migrate-gamified-accomplishments.mjs <approved.json> [--write]";

/** @param {string} message @returns {never} */
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Runs the CLI with an argument array (no shell). */
function cli(/** @type {string[]} */ args, /** @type {string | undefined} */ input) {
  const r = spawnSync("accomplishments", args, { input, encoding: "utf8" });
  if (r.error) return { ok: false, stdout: "", message: r.error.message };
  if (r.status !== 0) return { ok: false, stdout: r.stdout, message: (r.stderr || r.stdout || `exit ${r.status}`).trim() };
  return { ok: true, stdout: r.stdout, message: "" };
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const positionals = args.filter((a) => !a.startsWith("--"));
const unknownFlags = args.filter((a) => a.startsWith("--") && a !== "--write");
if (positionals.length !== 1 || unknownFlags.length > 0) fail(USAGE);

/** @type {Record<string, Record<string, unknown>>} */
let approved;
try {
  approved = JSON.parse(readFileSync(positionals[0], "utf8"));
} catch (e) {
  fail(`Cannot read ${positionals[0]}: ${e instanceof Error ? e.message : e}`);
}
if (approved === null || typeof approved !== "object" || Array.isArray(approved)) {
  fail("The approved file must be a JSON object keyed by rkey.");
}
for (const [rkey, entry] of Object.entries(approved)) {
  for (const f of FIELDS) {
    if (typeof entry?.[f] !== "string" || entry[f].trim() === "") {
      fail(`Approved entry ${rkey}: ${f} must be a non-empty string.`);
    }
  }
}

const listed = cli(["list", "--limit", "100"]);
if (!listed.ok) fail(`accomplishments list failed: ${listed.message}`);
/** @type {{ items: Array<{ uri?: string, cid?: string, rkey: string, value?: { title?: string, funTitle?: string } }>, total?: number, skippedInvalid?: number }} */
let list;
try {
  list = JSON.parse(listed.stdout);
  if (!Array.isArray(list.items)) throw new Error("no items array");
} catch (e) {
  fail(`Unexpected output from accomplishments list: ${e instanceof Error ? e.message : e}`);
}
if (list.skippedInvalid) {
  process.stdout.write(`Note: ${list.skippedInvalid} invalid record(s) were not listed and cannot be migrated.\n`);
}
if (typeof list.total === "number" && list.total > list.items.length) {
  process.stdout.write(`Note: ${list.total} records exist but only ${list.items.length} were listed.\n`);
}

const known = new Set(list.items.map((i) => i.rkey));
const unknown = Object.keys(approved).filter((r) => !known.has(r));

/** @type {Array<{ rkey: string, patch: Record<string, string> }>} */
const todo = [];
process.stdout.write(write ? "Write run\n" : "Dry run (nothing is written; re-run with --write)\n");
for (const item of list.items) {
  const head = `${item.rkey}  ${item.value?.title ?? ""}`;
  if (typeof item.value?.funTitle === "string" && item.value.funTitle !== "") {
    process.stdout.write(`${head}\n  skip: already has a funTitle\n`);
  } else if (!Object.hasOwn(approved, item.rkey)) {
    process.stdout.write(`${head}\n  skip: not in the approved file\n`);
  } else {
    const patch = Object.fromEntries(FIELDS.map((f) => [f, String(approved[item.rkey][f])]));
    todo.push({ rkey: item.rkey, patch });
    process.stdout.write(`${head}\n  add: ${JSON.stringify(patch)}\n`);
  }
}
for (const r of unknown) process.stdout.write(`${r}\n  unknown: in the approved file but not an existing record\n`);

if (!write) {
  process.stdout.write(`\n${todo.length} record(s) would be updated. Re-run with --write to apply.\n`);
  process.exit(0);
}

let done = 0;
for (const { rkey, patch } of todo) {
  const r = cli(["update", rkey], JSON.stringify(patch));
  if (!r.ok) {
    process.stderr.write(`Stopped at ${rkey} after ${done} update(s): ${r.message}\n`);
    process.exit(1);
  }
  done++;
  process.stdout.write(`updated ${rkey}\n`);
}
process.stdout.write(`\n${done} record(s) updated.\n`);
