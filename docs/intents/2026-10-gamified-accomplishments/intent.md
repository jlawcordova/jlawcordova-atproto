# Intent: Gamified accomplishments (records, Worker, CLI and skill)

> Status: Draft — Owner: J. Law Cordova — Date: 2026-10-03

## Why

The portfolio is turning its Accomplishments section into a Steam-style
achievement list: each accomplishment gets a fun title, a short description
and a pixel-art icon, and an accomplishment can be locked (not done yet). The
why, the full outcome and the constraints are in the parent intent in
`jlawcordova.github.io`:

- [Parent intent](https://github.com/jlawcordova/jlawcordova.github.io/blob/main/docs/intents/2026-10-gamified-accomplishments/intent.md)
- [Parent spec](https://github.com/jlawcordova/jlawcordova.github.io/blob/main/docs/intents/2026-10-gamified-accomplishments/spec.md)
  (R1 to R21, D1 to D7)
- [Parent plan](https://github.com/jlawcordova/jlawcordova.github.io/blob/main/docs/intents/2026-10-gamified-accomplishments/plan.md)
  (this intent is its PR 2)

This intent covers only this repo's part of that work. The parent intent is
the source of truth: where the two disagree, the parent wins and this intent
gets fixed.

## Intent

Let the records **carry a fun title, a short description, an icon and a done
flag**, let me **change a record in place** through the Worker, MCP and CLI,
and make the **`accomplishments` skill** suggest the new fields, manage locked
accomplishments and clear stale ones. A one-off **migration** gives the
existing records the new fields.

## Outcomes (what "done" looks like)

1. The Lexicon has the optional `funTitle`, `shortDescription`, `icon` (the 16
   IDs from the site's `achievement-icons.mjs` as `knownValues`) and `done`,
   and `startDate` is no longer required by the Lexicon (parent D1).
2. `shared` enforces the extra rules: `startDate` is required unless `done` is
   `false`, a locked record has no dates, and new writes require the three new
   fields with a one-to-three-word `funTitle` and a five-to-seven-word
   `shortDescription`. Reads stay as lenient as today, so every existing record
   is still valid.
3. A record can be **updated** in place, keeping its rkey and `createdAt`,
   through `PATCH /api/accomplishments/<rkey>`, the `update_accomplishment` MCP
   tool and `accomplishments update <rkey>` (parent D2). An update triggers the
   portfolio rebuild like `add`.
4. The skill drafts the new fields in the Stardew Valley voice, adds locked
   accomplishments on request, offers to mark one done when recent work matches
   it, and proposes deleting stale ones (older than 14 days), deleting only
   what I confirm (parent D7).
5. The migration gives every existing record a fun title, short description and
   icon that I approved, adds nothing else, and is deleted after it has run.
6. CLI **1.1.0** is released with `update`, and the skill zip in that release
   has the new skill.

## Scope

### In scope
- Lexicon, `shared` and their tests.
- `updateAccomplishment`, the `PATCH` route, the `update_accomplishment` tool,
  and the new fields on `add`.
- `accomplishments update <rkey>` and its tests; `docs/cli-setup.md`.
- The skill and its README.
- `scripts/migrate-gamified-accomplishments.mjs` and its test, both deleted
  after the run.
- Worker deploy, CLI 1.1.0 release.

### Out of scope
- The icons, the icon list, `/achievement-icons.json` and the icon skill
  (parent PR 1, merged in `jlawcordova.github.io#56`).
- Anything the site renders, and its fetch script (parent PR 3).
- A separate goals collection (the parent intent rejected it).
- Rejecting unknown icon IDs. `knownValues` is advisory, and the site shows its
  fallback icon for an unknown one.

## Constraints & principles

All of the parent intent's constraints hold. The ones that bite here:

- **Old records stay valid.** Every new field is optional on read. The
  stricter rules apply to writes through this Worker only, because Lexicon
  rules forbid adding required fields later (parent C4).
- **Updates never lose data.** `putRecord` replaces the whole record, so a
  patch of one field must leave every other field equal, and `swapRecord`
  makes a concurrent change fail instead of overwriting.
- **Public-safe.** Records are public once written, locked ones included. The
  skill keeps its approval step for every write, update and delete.
- **Same rules everywhere.** One validator and one `update` code path behind
  the API, MCP and CLI, as with `add`.
- **The migration only adds.** It writes the three new fields, never touches
  `title`, `description`, dates, tags or links, shows a dry run first, and
  skips records that already have a `funTitle`.

## Success criteria

- After the Worker deploy, `accomplishments list --limit 100` returns all
  existing records, and the site's next build shows the same count.
- `accomplishments update` on a throwaway record changes the one field asked
  for and leaves the rest equal (then the record is deleted).
- "Draft my accomplishments" suggests a fun title, short description and icon
  for each draft, lists stale locked records, and saves only what I pick.
- After the migration, every record has a fun title, short description and
  icon, and nothing else changed.
- CLI 1.1.0 installs from the release and `accomplishments update --help`
  works.

## Decisions

| Question | Decision |
| --- | --- |
| Where the intent lives | Here, as a sub-intent of the site's intent, because this repo starts all work from an intent folder and records progress in it |
| Contracts | Taken from the parent spec (D1, D2, D7) and not copied; this repo's [`spec.md`](spec.md) adds the details only this repo needs, the acceptance tests and the build order |
| One PR | Everything here lands in one PR, one commit per build step, as the parent plan says |
| Telling a write from a read | `shared` gets a write mode; reads use today's rules plus the optional fields |
| Releasing | A CLI minor version, 1.1.0, because `update` is a new command and the skill needs it |

## Open questions

None. Details are in [`spec.md`](spec.md).

## AI-native SDLC

1. **Intent** (this document) — done (#20).
2. **Spec** — the rules, `update` contract, skill changes, migration and
   acceptance tests in [`spec.md`](spec.md) — done (#20).
3. **Plan** — the build order in [`spec.md`](spec.md#9-build-order) — done
   (#20).
4. **Implement & verify** — in progress. Build steps 1 to 7 are on one
   branch, one commit per step. On the combined branch, `npm test` passes
   (shared 62, mcp 74, cli 44), `npm run typecheck` is clean, and
   `node --test "scripts/*.test.mjs"` passes 6 of 6. That covers V1 to V10,
   U1 to U13, C1 to C4 and M1 to M3. The fixture holds no real record
   text: checked against the live `list` output. S2 passed on 2026-10-04:
   the owner approved drafts for the nine real records and a goal, and kept
   the skill's two added rules (future-tense goals, an optional new
   description on marking done). Not verified yet: S1, S3 to S6 (need a
   real run after step 8), C5, D1, D2 and M4.
5. **Deploy & operate** — not started.
6. **Close** — not started.
