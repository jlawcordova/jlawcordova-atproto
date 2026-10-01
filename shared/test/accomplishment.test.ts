import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NSID,
  compareAccomplishments,
  lexicon,
  validateAccomplishment,
  type Accomplishment,
} from "../src/index.js";

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
  it("V1: accepts a minimal valid record", () => {
    expect(validateAccomplishment(minimal)).toEqual({ ok: true, value: minimal });
  });

  it("V2: accepts a full valid record", () => {
    expect(validateAccomplishment(full)).toEqual({ ok: true, value: full });
  });

  it("V2: accepts a record carrying the correct $type and rejects another", () => {
    expect(validateAccomplishment({ ...minimal, $type: NSID }).ok).toBe(true);
    expect(fieldsFor({ ...minimal, $type: "app.bsky.feed.post" })).toEqual(["$type"]);
  });

  it("rejects non-objects", () => {
    for (const input of [null, undefined, "x", 1, []]) {
      expect(errorsFor(input)).toEqual([{ field: "record", message: "must be an object" }]);
    }
  });

  it.each(["title", "description", "startDate", "createdAt"])(
    "V3: missing %s names the field",
    (field) => {
      const input: Record<string, unknown> = { ...minimal };
      delete input[field];
      expect(errorsFor(input)).toEqual([{ field, message: "is required" }]);
    },
  );

  it("V3: reports every missing field at once", () => {
    expect(fieldsFor({})).toEqual(["title", "description", "startDate", "createdAt"]);
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

  it("V4: title limit is 200 graphemes", () => {
    expect(validateAccomplishment({ ...minimal, title: "a".repeat(200) }).ok).toBe(true);
    expect(fieldsFor({ ...minimal, title: "a".repeat(201) })).toEqual(["title"]);
  });

  it("V4: description limit is 1000 graphemes", () => {
    expect(validateAccomplishment({ ...minimal, description: "a".repeat(1000) }).ok).toBe(true);
    expect(fieldsFor({ ...minimal, description: "a".repeat(1001) })).toEqual(["description"]);
  });

  it("V4: an emoji counts as one grapheme", () => {
    // Four UTF-8 bytes each, so only the grapheme limit can be what trips.
    expect(validateAccomplishment({ ...minimal, title: "😀".repeat(200) }).ok).toBe(true);
    expect(fieldsFor({ ...minimal, title: "😀".repeat(201) })).toEqual(["title"]);
    expect(validateAccomplishment({ ...minimal, description: "😀".repeat(1000) }).ok).toBe(true);
    expect(fieldsFor({ ...minimal, description: "😀".repeat(1001) })).toEqual(["description"]);
  });

  it.each(["2026-13", "2026-1", "26-01", "2026-01-01", "2026-00", "1969-12", "2101-01", "abcd-01"])(
    "V5: startDate %s fails",
    (startDate) => {
      expect(fieldsFor({ ...minimal, startDate })).toEqual(["startDate"]);
    },
  );

  it("V5: startDate accepts the range ends", () => {
    expect(validateAccomplishment({ ...minimal, startDate: "1970-01" }).ok).toBe(true);
    expect(validateAccomplishment({ ...minimal, startDate: "2100-12", endDate: "2100-12" }).ok).toBe(true);
  });

  it("V5: endDate uses the same format rules", () => {
    expect(fieldsFor({ ...minimal, endDate: "2026-13" })).toEqual(["endDate"]);
  });

  it("V6: endDate before startDate fails, equal passes", () => {
    expect(errorsFor({ ...minimal, startDate: "2026-05", endDate: "2026-04" })).toEqual([
      { field: "endDate", message: "must not be before startDate" },
    ]);
    expect(validateAccomplishment({ ...minimal, startDate: "2026-05", endDate: "2026-05" }).ok).toBe(true);
    expect(validateAccomplishment({ ...minimal, startDate: "2025-12", endDate: "2026-01" }).ok).toBe(true);
  });

  it("V7: 10 tags pass, 11 fail", () => {
    const tag = (i: number) => `tag${i}`;
    expect(validateAccomplishment({ ...minimal, tags: Array.from({ length: 10 }, (_, i) => tag(i)) }).ok).toBe(true);
    expect(fieldsFor({ ...minimal, tags: Array.from({ length: 11 }, (_, i) => tag(i)) })).toEqual(["tags"]);
  });

  it("V7: duplicate tags fail case-insensitively", () => {
    expect(errorsFor({ ...minimal, tags: ["TS", "go", "ts"] })).toEqual([
      { field: "tags[2]", message: "duplicates tags[0] (ignoring case)" },
    ]);
    expect(fieldsFor({ ...minimal, tags: ["ts", " TS "] })).toEqual(["tags[1]"]);
  });

  it("V7: empty and whitespace-only tags fail", () => {
    expect(fieldsFor({ ...minimal, tags: ["ok", ""] })).toEqual(["tags[1]"]);
    expect(fieldsFor({ ...minimal, tags: ["   "] })).toEqual(["tags[0]"]);
  });

  it("V7: a tag is limited to 64 graphemes", () => {
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
  ])("V8: link %j fails", (link) => {
    expect(fieldsFor({ ...minimal, links: ["https://ok.example", link] })).toEqual(["links[1]"]);
  });

  it("V8: http and https links pass", () => {
    expect(validateAccomplishment({ ...minimal, links: ["https://example.com/a?b=c", "http://example.com"] }).ok).toBe(true);
  });

  it("V8: more than 10 links fail", () => {
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

  it("V9: sorts newest first", () => {
    const old = make({ startDate: "2024-01" });
    const recent = make({ startDate: "2026-02" });
    expect([old, recent].sort(compareAccomplishments)).toEqual([recent, old]);
  });

  it("V9: endDate beats startDate", () => {
    const longRunning = make({ startDate: "2020-01", endDate: "2026-06" });
    const newerStart = make({ startDate: "2026-03" });
    expect([newerStart, longRunning].sort(compareAccomplishments)).toEqual([longRunning, newerStart]);
  });

  it("V9: ties break on createdAt descending", () => {
    const first = make({ startDate: "2026-03", createdAt: "2026-04-01T00:00:00Z" });
    const second = make({ startDate: "2026-03", createdAt: "2026-05-01T00:00:00Z" });
    expect([first, second].sort(compareAccomplishments)).toEqual([second, first]);
  });

  it("V9: createdAt compares as instants across time zones", () => {
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

  it("V10: the bundled Lexicon is the file in lexicons/", () => {
    const onDisk = JSON.parse(
      readFileSync(new URL("../../lexicons/com/jlawcordova/profile/accomplishment.json", import.meta.url), "utf8"),
    );
    expect(lexicon).toEqual(onDisk);
    expect(onDisk.id).toBe(NSID);
  });

  it("V10: limits in the Lexicon match the spec and the validator", () => {
    expect(props.title.maxGraphemes).toBe(200);
    expect(props.description.maxGraphemes).toBe(1000);
    expect(props.tags.maxLength).toBe(10);
    expect(props.tags.items.maxGraphemes).toBe(64);
    expect(props.links.maxLength).toBe(10);
    expect(props.startDate.maxLength).toBe(7);
    expect(props.endDate.maxLength).toBe(7);
    expect(lexicon.defs.main.record.required).toEqual(["title", "description", "startDate", "createdAt"]);
  });

  it("V10: byte limits are 10x the grapheme limits", () => {
    expect(props.title.maxLength).toBe(props.title.maxGraphemes * 10);
    expect(props.description.maxLength).toBe(props.description.maxGraphemes * 10);
    expect(props.tags.items.maxLength).toBe(props.tags.items.maxGraphemes * 10);
  });

  it("V10: the validator enforces the Lexicon's limits at their boundaries", () => {
    const { title, description } = props;
    expect(validateAccomplishment({ ...minimal, title: "a".repeat(title.maxGraphemes) }).ok).toBe(true);
    expect(validateAccomplishment({ ...minimal, title: "a".repeat(title.maxGraphemes + 1) }).ok).toBe(false);
    expect(validateAccomplishment({ ...minimal, description: "a".repeat(description.maxGraphemes) }).ok).toBe(true);
    expect(validateAccomplishment({ ...minimal, description: "a".repeat(description.maxGraphemes + 1) }).ok).toBe(false);
  });
});
