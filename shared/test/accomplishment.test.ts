import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NSID,
  compareAccomplishments,
  lexicon,
  validateAccomplishment,
  type Accomplishment,
} from "../src/index.js";

const fixture: Accomplishment[] = JSON.parse(
  readFileSync(new URL("./fixtures/records-2026-10.json", import.meta.url), "utf8"),
);

const minimal = {
  title: "Cut deploy time by 40%",
  description: "Rebuilt the CI pipeline, cutting deploys from 10 to 6 minutes.",
  startDate: "2026-01",
  createdAt: "2026-10-01T00:00:00.000Z",
};

const full = {
  ...minimal,
  endDate: "2026-03",
  tags: ["CI", "TypeScript"],
  links: ["https://github.com/jlawcordova/example/pull/1"],
};

function errorsFor(input: unknown) {
  const result = validateAccomplishment(input);
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}

function fieldsFor(input: unknown) {
  return errorsFor(input).map((e) => e.field);
}

describe("validateAccomplishment", () => {
  it("accepts a minimal valid record", () => {
    expect(validateAccomplishment(minimal)).toEqual({ ok: true, value: minimal });
  });

  it("accepts a full valid record", () => {
    expect(validateAccomplishment(full)).toEqual({ ok: true, value: full });
  });

  it("accepts a record carrying the correct $type and rejects another", () => {
    expect(validateAccomplishment({ ...minimal, $type: NSID }).ok).toBe(true);
    expect(fieldsFor({ ...minimal, $type: "app.bsky.feed.post" })).toEqual(["$type"]);
  });

  it("rejects non-objects", () => {
    for (const input of [null, undefined, "x", 1, []]) {
      expect(errorsFor(input)).toEqual([{ field: "record", message: "must be an object" }]);
    }
  });

  it.each(["title", "description", "createdAt"])(
    "missing %s names the field",
    (field) => {
      const input: Record<string, unknown> = { ...minimal };
      delete input[field];
      expect(errorsFor(input)).toEqual([{ field, message: "is required" }]);
    },
  );

  it("reports every missing field at once", () => {
    expect(fieldsFor({}).sort()).toEqual(["createdAt", "description", "startDate", "title"]);
  });

  it("rejects wrong types and a bad createdAt", () => {
    expect(fieldsFor({ ...minimal, title: 5 })).toEqual(["title"]);
    expect(fieldsFor({ ...minimal, createdAt: "yesterday" })).toEqual(["createdAt"]);
    expect(fieldsFor({ ...minimal, tags: [1] })).toEqual(["tags[0]"]);
  });

  it("rejects empty and whitespace-only title and description", () => {
    expect(errorsFor({ ...minimal, title: "   ", description: "" })).toEqual([
      { field: "title", message: "must not be empty" },
      { field: "description", message: "must not be empty" },
    ]);
  });

  it("trims title, description, and tags, and nothing else", () => {
    const result = validateAccomplishment({
      ...minimal,
      title: "  Shipped it  ",
      description: "\tDone.\n",
      tags: [" a ", "b"],
    });
    expect(result).toEqual({
      ok: true,
      value: { ...minimal, title: "Shipped it", description: "Done.", tags: ["a", "b"] },
    });
  });

  it("does not invent fields", () => {
    const result = validateAccomplishment(minimal);
    expect(result.ok && Object.keys(result.value).sort()).toEqual(Object.keys(minimal).sort());
  });

  it("title limit is 200 graphemes", () => {
    expect(validateAccomplishment({ ...minimal, title: "a".repeat(200) }).ok).toBe(true);
    expect(fieldsFor({ ...minimal, title: "a".repeat(201) })).toEqual(["title"]);
  });

  it("description limit is 1000 graphemes", () => {
    expect(validateAccomplishment({ ...minimal, description: "a".repeat(1000) }).ok).toBe(true);
    expect(fieldsFor({ ...minimal, description: "a".repeat(1001) })).toEqual(["description"]);
  });

  it("an emoji counts as one grapheme", () => {
    // Four UTF-8 bytes each, so only the grapheme limit can be what trips.
    expect(validateAccomplishment({ ...minimal, title: "😀".repeat(200) }).ok).toBe(true);
    expect(fieldsFor({ ...minimal, title: "😀".repeat(201) })).toEqual(["title"]);
    expect(validateAccomplishment({ ...minimal, description: "😀".repeat(1000) }).ok).toBe(true);
    expect(fieldsFor({ ...minimal, description: "😀".repeat(1001) })).toEqual(["description"]);
  });

  it.each(["2026-13", "2026-1", "26-01", "2026-01-01", "2026-00", "1969-12", "2101-01", "abcd-01"])(
    "startDate %s fails",
    (startDate) => {
      expect(fieldsFor({ ...minimal, startDate })).toEqual(["startDate"]);
    },
  );

  it("startDate accepts the range ends", () => {
    expect(validateAccomplishment({ ...minimal, startDate: "1970-01" }).ok).toBe(true);
    expect(validateAccomplishment({ ...minimal, startDate: "2100-12", endDate: "2100-12" }).ok).toBe(true);
  });

  it("endDate uses the same format rules", () => {
    expect(fieldsFor({ ...minimal, endDate: "2026-13" })).toEqual(["endDate"]);
  });

  it("endDate before startDate fails, equal passes", () => {
    expect(errorsFor({ ...minimal, startDate: "2026-05", endDate: "2026-04" })).toEqual([
      { field: "endDate", message: "must not be before startDate" },
    ]);
    expect(validateAccomplishment({ ...minimal, startDate: "2026-05", endDate: "2026-05" }).ok).toBe(true);
    expect(validateAccomplishment({ ...minimal, startDate: "2025-12", endDate: "2026-01" }).ok).toBe(true);
  });

  it("10 tags pass, 11 fail", () => {
    const tag = (i: number) => `tag${i}`;
    expect(validateAccomplishment({ ...minimal, tags: Array.from({ length: 10 }, (_, i) => tag(i)) }).ok).toBe(true);
    expect(fieldsFor({ ...minimal, tags: Array.from({ length: 11 }, (_, i) => tag(i)) })).toEqual(["tags"]);
  });

  it("duplicate tags fail case-insensitively", () => {
    expect(errorsFor({ ...minimal, tags: ["TS", "go", "ts"] })).toEqual([
      { field: "tags[2]", message: "duplicates tags[0] (ignoring case)" },
    ]);
    expect(fieldsFor({ ...minimal, tags: ["ts", " TS "] })).toEqual(["tags[1]"]);
  });

  it("empty and whitespace-only tags fail", () => {
    expect(fieldsFor({ ...minimal, tags: ["ok", ""] })).toEqual(["tags[1]"]);
    expect(fieldsFor({ ...minimal, tags: ["   "] })).toEqual(["tags[0]"]);
  });

  it("a tag is limited to 64 graphemes", () => {
    expect(validateAccomplishment({ ...minimal, tags: ["a".repeat(64)] }).ok).toBe(true);
    expect(fieldsFor({ ...minimal, tags: ["a".repeat(65)] })).toEqual(["tags[0]"]);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://example.com/file",
    "/relative/path",
    "example.com",
    "https://",
    "",
  ])("link %j fails", (link) => {
    expect(fieldsFor({ ...minimal, links: ["https://ok.example", link] })).toEqual(["links[1]"]);
  });

  it("http and https links pass", () => {
    expect(validateAccomplishment({ ...minimal, links: ["https://example.com/a?b=c", "http://example.com"] }).ok).toBe(true);
  });

  it("more than 10 links fail", () => {
    const links = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`);
    expect(fieldsFor({ ...minimal, links })).toEqual(["links"]);
  });

  it("reports every problem at once, with plain wording", () => {
    const errors = errorsFor({
      title: "",
      description: "ok",
      startDate: "2026-1",
      endDate: "nope",
      tags: ["a", "A"],
      links: ["https://ok.example", "javascript:alert(1)"],
      createdAt: "2026-10-01T00:00:00Z",
    });
    expect(errors.map((e) => e.field).sort()).toEqual(
      ["endDate", "links[1]", "startDate", "tags[1]", "title"].sort(),
    );
    expect(errors.find((e) => e.field === "startDate")?.message).toMatch(/YYYY-MM/);
  });
});

describe("compareAccomplishments", () => {
  const make = (over: Partial<Accomplishment>): Accomplishment => ({ ...minimal, ...over });

  it("sorts newest first", () => {
    const old = make({ startDate: "2024-01" });
    const recent = make({ startDate: "2026-02" });
    expect([old, recent].sort(compareAccomplishments)).toEqual([recent, old]);
  });

  it("endDate beats startDate", () => {
    const longRunning = make({ startDate: "2020-01", endDate: "2026-06" });
    const newerStart = make({ startDate: "2026-03" });
    expect([newerStart, longRunning].sort(compareAccomplishments)).toEqual([longRunning, newerStart]);
  });

  it("ties break on createdAt descending", () => {
    const first = make({ startDate: "2026-03", createdAt: "2026-04-01T00:00:00Z" });
    const second = make({ startDate: "2026-03", createdAt: "2026-05-01T00:00:00Z" });
    expect([first, second].sort(compareAccomplishments)).toEqual([second, first]);
  });

  it("createdAt compares as instants across time zones", () => {
    const earlier = make({ createdAt: "2026-05-01T10:00:00+09:00" }); // 01:00Z
    const later = make({ createdAt: "2026-05-01T05:00:00Z" });
    expect([earlier, later].sort(compareAccomplishments)).toEqual([later, earlier]);
  });

  it("returns 0 for identical sort keys", () => {
    expect(compareAccomplishments(make({}), make({}))).toBe(0);
  });
});

describe("Lexicon drift", () => {
  const props = lexicon.defs.main.record.properties;

  it("the bundled Lexicon is the file in lexicons/", () => {
    const onDisk = JSON.parse(
      readFileSync(new URL("../../lexicons/com/jlawcordova/profile/accomplishment.json", import.meta.url), "utf8"),
    );
    expect(lexicon).toEqual(onDisk);
    expect(onDisk.id).toBe(NSID);
  });

  it("limits in the Lexicon match the spec and the validator", () => {
    expect(props.title.maxGraphemes).toBe(200);
    expect(props.description.maxGraphemes).toBe(1000);
    expect(props.tags.maxLength).toBe(10);
    expect(props.tags.items.maxGraphemes).toBe(64);
    expect(props.links.maxLength).toBe(10);
    expect(props.startDate.maxLength).toBe(7);
    expect(props.endDate.maxLength).toBe(7);
    expect(lexicon.defs.main.record.required).toEqual(["title", "description", "createdAt"]);
  });

  it("byte limits are 10x the grapheme limits", () => {
    expect(props.title.maxLength).toBe(props.title.maxGraphemes * 10);
    expect(props.description.maxLength).toBe(props.description.maxGraphemes * 10);
    expect(props.tags.items.maxLength).toBe(props.tags.items.maxGraphemes * 10);
  });

  it("the validator enforces the Lexicon's limits at their boundaries", () => {
    const { title, description } = props;
    expect(validateAccomplishment({ ...minimal, title: "a".repeat(title.maxGraphemes) }).ok).toBe(true);
    expect(validateAccomplishment({ ...minimal, title: "a".repeat(title.maxGraphemes + 1) }).ok).toBe(false);
    expect(validateAccomplishment({ ...minimal, description: "a".repeat(description.maxGraphemes) }).ok).toBe(true);
    expect(validateAccomplishment({ ...minimal, description: "a".repeat(description.maxGraphemes + 1) }).ok).toBe(false);
  });
});

const gamified = {
  ...minimal,
  funTitle: "Bug Squasher",
  shortDescription: "Fixed the flaky deploy for good",
  icon: "bug",
};

const locked = {
  title: "Ship the portfolio rebuild",
  description: "A goal that is not reached yet.",
  done: false,
  createdAt: "2026-10-01T00:00:00.000Z",
};

const writeErrors = (input: unknown) => {
  const result = validateAccomplishment(input, { mode: "write" });
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
};
const writeFields = (input: unknown) => writeErrors(input).map((e) => e.field);
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("gamified fields", () => {
  const props: Record<string, Record<string, unknown>> = lexicon.defs.main.record.properties;

  it("V1: the Lexicon has the four new properties with their limits and 16 known icons", () => {
    expect(props.funTitle).toMatchObject({ type: "string", maxGraphemes: 60 });
    expect(props.shortDescription).toMatchObject({ type: "string", maxGraphemes: 80 });
    expect(props.icon).toMatchObject({ type: "string", maxGraphemes: 32 });
    expect(props.done).toMatchObject({ type: "boolean", default: true });
    expect(props.icon!.knownValues).toEqual([
      "sprout", "hammer", "rocket", "bug", "shield", "key", "wrench", "book",
      "magnifier", "flask", "apple", "heart", "signpost", "chest", "trophy", "speech",
    ]);
    expect(lexicon.defs.main.record.required).not.toContain("startDate");
  });

  it("V1: the byte limits are 10x the grapheme limits", () => {
    for (const key of ["funTitle", "shortDescription", "icon"]) {
      expect(props[key]!.maxLength).toBe((props[key]!.maxGraphemes as number) * 10);
    }
    expect(validateAccomplishment({ ...gamified, funTitle: "a".repeat(61) }).ok).toBe(false);
    expect(validateAccomplishment({ ...gamified, icon: "a".repeat(33) }).ok).toBe(false);
  });

  it("V2: every fixture record validates in read mode, unchanged, and sorts as before", () => {
    expect(fixture).toHaveLength(9);
    for (const record of fixture) {
      expect(validateAccomplishment(record)).toEqual({ ok: true, value: record });
    }
    // Every record sorts under 2026-10 (the two-month one by its endDate), so createdAt decides.
    const sorted = [...fixture].sort(compareAccomplishments).map((r) => r.title.split(":")[0]);
    expect(sorted).toEqual([
      "Fixture alpha", "Fixture bravo", "Fixture charlie", "Fixture delta", "Fixture echo",
      "Fixture foxtrot", "Fixture golf", "Fixture hotel", "Fixture india",
    ]);
  });

  it("V3: startDate is required unless done is false", () => {
    const { startDate: _, ...noStart } = minimal;
    expect(errorsFor(noStart)).toEqual([{ field: "startDate", message: "is required unless done is false" }]);
    expect(fieldsFor({ ...noStart, done: true })).toEqual(["startDate"]);
    expect(validateAccomplishment(locked).ok).toBe(true);
    expect(validateAccomplishment({ ...gamified, done: true }).ok).toBe(true);
  });

  it("V4: a locked record with a startDate or endDate fails, naming the field", () => {
    expect(errorsFor({ ...locked, startDate: "2026-01" })).toEqual([
      { field: "startDate", message: "must be absent while done is false" },
    ]);
    expect(errorsFor({ ...locked, endDate: "2026-01" })).toEqual([
      { field: "endDate", message: "must be absent while done is false" },
    ]);
    expect(fieldsFor({ ...locked, startDate: "2026-01", endDate: "2026-02" })).toEqual(["startDate", "endDate"]);
  });

  it("V5: write mode lists each missing funTitle, shortDescription and icon; read mode accepts", () => {
    expect(validateAccomplishment(minimal).ok).toBe(true);
    expect(writeErrors(minimal)).toEqual([
      { field: "funTitle", message: "is required" },
      { field: "shortDescription", message: "is required" },
      { field: "icon", message: "is required" },
    ]);
    expect(writeFields({ ...gamified, icon: undefined })).toEqual(["icon"]);
    expect(writeFields({ ...gamified, funTitle: "  " })).toEqual(["funTitle"]);
    expect(validateAccomplishment(gamified, { mode: "write" })).toEqual({ ok: true, value: gamified });
  });

  it("V5: write mode also checks a locked record", () => {
    expect(writeFields(locked)).toEqual(["funTitle", "shortDescription", "icon"]);
    expect(validateAccomplishment({ ...locked, ...gamified, startDate: undefined }, { mode: "write" }).ok).toBe(true);
  });

  it("V6: funTitle is one to three words in write mode", () => {
    expect(writeErrors({ ...gamified, funTitle: "" })).toEqual([{ field: "funTitle", message: "is required" }]);
    expect(writeErrors({ ...gamified, funTitle: words(4) })).toEqual([
      { field: "funTitle", message: "must be one to three words" },
    ]);
    for (const funTitle of [words(1), words(3), "Mid-sprint save", "  padded  title  "]) {
      expect(validateAccomplishment({ ...gamified, funTitle }, { mode: "write" }).ok).toBe(true);
    }
    expect(validateAccomplishment({ ...gamified, funTitle: words(4) }).ok).toBe(true); // read mode
  });

  it("V6: shortDescription is five to seven words in write mode", () => {
    for (const n of [4, 8]) {
      expect(writeErrors({ ...gamified, shortDescription: words(n) })).toEqual([
        { field: "shortDescription", message: "must be five to seven words" },
      ]);
    }
    for (const n of [5, 7]) {
      expect(validateAccomplishment({ ...gamified, shortDescription: words(n) }, { mode: "write" }).ok).toBe(true);
    }
    expect(validateAccomplishment({ ...gamified, shortDescription: words(2) }).ok).toBe(true); // read mode
  });

  it("V6: funTitle and shortDescription are trimmed", () => {
    const result = validateAccomplishment(
      { ...gamified, funTitle: "  Bug Squasher ", shortDescription: "\tFixed the flaky deploy for good\n" },
      { mode: "write" },
    );
    expect(result).toEqual({ ok: true, value: gamified });
  });

  it("V7: icon must be kebab-case in both modes, and an unknown kebab-case ID passes", () => {
    for (const icon of ["Bug", "bug_2", "-bug", "two  words", "bug-", "my icon"]) {
      expect(errorsFor({ ...gamified, icon })).toEqual([{ field: "icon", message: "must be lowercase kebab-case" }]);
      expect(writeFields({ ...gamified, icon })).toEqual(["icon"]);
    }
    for (const icon of ["not-in-the-list", "star", "a1"]) {
      expect(validateAccomplishment({ ...gamified, icon }, { mode: "write" }).ok).toBe(true);
    }
  });

  it("V8: done must be a boolean; an absent done stays absent and counts as done", () => {
    for (const done of ["false", 0, null, "yes"]) {
      expect(fieldsFor({ ...gamified, done })).toContain("done");
    }
    const result = validateAccomplishment(gamified, { mode: "write" });
    expect(result.ok && "done" in result.value).toBe(false);
    // Counts as done: startDate is still required.
    const { startDate: _, ...noStart } = gamified;
    expect(fieldsFor(noStart)).toEqual(["startDate"]);
    expect(validateAccomplishment({ ...gamified, done: true }).ok).toBe(true);
  });

  it("V9: locked records sort first, newest createdAt first, then done records as before", () => {
    const make = (over: Partial<Accomplishment>): Accomplishment => ({ ...gamified, ...over });
    const lockedOld = make({ title: "lockedOld", done: false, startDate: undefined, createdAt: "2026-05-01T00:00:00Z" });
    const lockedNew = make({ title: "lockedNew", done: false, startDate: undefined, createdAt: "2026-09-01T00:00:00Z" });
    const doneNew = make({ title: "doneNew", startDate: "2026-09" });
    const doneOld = make({ title: "doneOld", startDate: "2020-01" });
    const doneExplicit = make({ title: "doneExplicit", done: true, startDate: "2026-02" });
    const sorted = [doneOld, lockedOld, doneExplicit, doneNew, lockedNew].sort(compareAccomplishments);
    expect(sorted.map((r) => r.title)).toEqual(["lockedNew", "lockedOld", "doneNew", "doneExplicit", "doneOld"]);
  });
});
