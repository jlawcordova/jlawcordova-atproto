// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "migrate-gamified-accomplishments.mjs");

const NEW = { funTitle: "Bug Slayer", shortDescription: "Squashed a nasty production bug", icon: "bug" };

/**
 * Sets up a sandbox with a fake `accomplishments` executable. PATH is only the
 * sandbox bin dir, and the fake uses node's absolute path, so the real CLI can
 * never be reached.
 * @param {{ items: object[], failOn?: string }} state
 * @param {object} approved
 */
function sandbox(state, approved = {}) {
  const dir = mkdtempSync(join(tmpdir(), "migrate-test-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const statePath = join(dir, "state.json");
  const callsPath = join(dir, "calls.jsonl");
  writeFileSync(statePath, JSON.stringify(state));
  writeFileSync(callsPath, "");
  const fake = `#!${process.execPath}
const fs = require("node:fs");
const [cmd, rkey] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}, "utf8"));
const stdin = cmd === "update" ? fs.readFileSync(0, "utf8") : null;
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ args: process.argv.slice(2), stdin }) + "\\n");
if (cmd === "list") {
  process.stdout.write(JSON.stringify({ items: state.items, total: state.items.length, skippedInvalid: 0 }));
} else if (cmd === "update") {
  if (state.failOn === rkey) {
    process.stderr.write(JSON.stringify({ error: "conflict", message: "The record changed while updating." }));
    process.exit(1);
  }
  const item = state.items.find((i) => i.rkey === rkey);
  Object.assign(item.value, JSON.parse(stdin));
  fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify(state));
  process.stdout.write(JSON.stringify(item));
} else {
  process.stderr.write("unexpected command " + cmd);
  process.exit(2);
}
`;
  const fakePath = join(bin, "accomplishments");
  writeFileSync(fakePath, fake);
  chmodSync(fakePath, 0o755);
  const approvedPath = join(dir, "approved.json");
  writeFileSync(approvedPath, JSON.stringify(approved));
  const calls = () =>
    readFileSync(callsPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return {
    bin,
    calls,
    updates: () => calls().filter((c) => c.args[0] === "update"),
    run(/** @type {string[]} */ extra = []) {
      return spawnSync(process.execPath, [SCRIPT, approvedPath, ...extra], {
        encoding: "utf8",
        env: { PATH: bin },
      });
    },
  };
}

const rec = (/** @type {string} */ rkey, /** @type {object} */ extra = {}) => ({
  uri: `at://did:plc:fake/com.jlawcordova.profile.accomplishment/${rkey}`,
  cid: `bafy${rkey}`,
  rkey,
  value: {
    $type: "com.jlawcordova.profile.accomplishment",
    title: `Title ${rkey}`,
    description: "Old description",
    startDate: "2026-01",
    ...extra,
  },
});

test("the fake is the only accomplishments on PATH", () => {
  const s = sandbox({ items: [] });
  const r = spawnSync("accomplishments", ["list"], { encoding: "utf8", env: { PATH: s.bin } });
  assert.equal(r.status, 0);
  assert.equal(s.calls().length, 1);
});

test("M1: the dry run prints planned fields and skip reasons, lists unknown rkeys, and writes nothing", () => {
  const s = sandbox(
    { items: [rec("a1"), rec("b2", { funTitle: "Done Already" }), rec("c3")] },
    { a1: NEW, b2: NEW, zz9: NEW },
  );
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /a1 {2}Title a1\n {2}add: .*"funTitle":"Bug Slayer".*"shortDescription".*"icon":"bug"/);
  assert.match(r.stdout, /b2 {2}Title b2\n {2}skip: already has a funTitle/);
  assert.match(r.stdout, /c3 {2}Title c3\n {2}skip: not in the approved file/);
  assert.match(r.stdout, /zz9\n {2}unknown:/);
  assert.deepEqual(s.calls().map((c) => c.args), [["list", "--limit", "100"]]);
  assert.equal(s.updates().length, 0);
});

test("M2: --write sends exactly the three fields per record and skips records with a funTitle", () => {
  const s = sandbox(
    { items: [rec("a1"), rec("b2", { funTitle: "Done Already" }), rec("c3")] },
    { a1: { ...NEW, title: "sneaky" }, b2: NEW, c3: NEW },
  );
  const r = s.run(["--write"]);
  assert.equal(r.status, 0, r.stderr);
  const updates = s.updates();
  assert.deepEqual(updates.map((u) => u.args), [["update", "a1"], ["update", "c3"]]);
  assert.deepEqual(JSON.parse(updates[0].stdin), NEW);
  assert.deepEqual(Object.keys(JSON.parse(updates[1].stdin)).sort(), ["funTitle", "icon", "shortDescription"]);
});

test("M2: a rerun writes nothing", () => {
  const s = sandbox({ items: [rec("a1"), rec("c3")] }, { a1: NEW, c3: NEW });
  assert.equal(s.run(["--write"]).status, 0);
  assert.equal(s.updates().length, 2);
  const again = s.run(["--write"]);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(s.updates().length, 2);
  assert.match(again.stdout, /0 record\(s\) updated/);
});

test("M3: --write stops at the first failure and names the rkey", () => {
  const s = sandbox(
    { items: [rec("a1"), rec("b2"), rec("c3")], failOn: "b2" },
    { a1: NEW, b2: NEW, c3: NEW },
  );
  const r = s.run(["--write"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Stopped at b2/);
  assert.match(r.stderr, /conflict/);
  assert.deepEqual(s.updates().map((u) => u.args[1]), ["a1", "b2"]);
});

test("an approved entry missing a field is rejected before any call", () => {
  const s = sandbox({ items: [rec("a1")] }, { a1: { funTitle: "X", icon: "bug" } });
  const r = s.run(["--write"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a1.*shortDescription/);
  assert.equal(s.calls().length, 0);
});
