# Intent: Accomplishments on AT Protocol

> Status: **Closed** (v0.3) — Owner: J. Law Cordova — Date: 2026-10-01 —
> Closed: 2026-10-01

## Why

My work accomplishments are scattered across résumés, performance reviews, chat
threads, and memory. I want one canonical, durable list that **I own**, which I
can publish on my portfolio website and reuse anywhere else.

Storing them as records in my AT Protocol repository (my PDS) gives me:

- **Ownership and portability** — the data lives in my repo, not in a
  proprietary database or a single website's backend.
- **Open, typed data** — a Lexicon schema makes the records self-describing and
  readable by any client (portfolio site, feeds, other tools).
- **Public by default** — records are publicly readable via the protocol, so the
  portfolio needs no private API to display them.

## Intent

Let me **list, save, and delete my work accomplishments as AT Protocol records**,
operable by an AI assistant through an **MCP server** that is **deployed** and
reachable remotely, and **show them on my portfolio** at https://jlawcordova.com.

The records are the product. The portfolio is their first consumer and reads
them from the public repo like any other client would.

## Outcomes (what "done" looks like)

1. An **accomplishment Lexicon** exists under a namespace I control
   (derived from `jlawcordova.com`) and describes a single accomplishment.
2. I can **write** an accomplishment and it appears as a record in my AT Proto
   repo.
3. I can **list** my accomplishments and get them back in a stable, sensible
   order (most recent first; see [Ordering](#ordering)).
4. I can **delete** an accomplishment by its record key and it is gone from my
   repo.
5. These three operations are exposed as **MCP tools** on a **deployed server**,
   so I can use them from Claude (and any other MCP client) from anywhere.
6. My portfolio shows an **Accomplishments** section built from the same
   records, read **directly from the public repo** without authentication.
7. Adding or deleting a record **triggers a portfolio rebuild**, and a daily
   scheduled build catches anything the trigger missed.

## Scope

### In scope
- Lexicon definition for an accomplishment record.
- A shared TypeScript validator for the record, with unit tests.
- MCP server with three tools: `add_accomplishment`, `list_accomplishments`,
  `delete_accomplishment`.
- Authentication of the server to my PDS, and protection of the MCP endpoint so
  that only I can write or delete.
- Deployment of the MCP server to Cloudflare Workers.
- Portfolio (`jlawcordova/jlawcordova.github.io`): a build step that fetches the
  records, an Accomplishments section, and a workflow that rebuilds on push, on
  a `repository_dispatch` of type `atproto-updated`, and daily.
- A prompt for a weekly scheduled Claude task that drafts accomplishments from
  my GitHub activity for me to approve.

### Out of scope (for now)
- Importing/backfilling historical accomplishments (can be done later *through*
  the MCP tools).
- An `update` tool — v1 relies on delete + recreate.
- Multi-user support — this is a single-owner system.
- Rich media attachments (images, blobs) on accomplishments.
- Search, filtering UI, analytics, or any non-AT-Proto storage of records.

## Record shape

NSID: `com.jlawcordova.profile.accomplishment`, record key `tid`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string, max 200 graphemes | yes | Short headline |
| `description` | string, max 1000 graphemes | yes | What I did and the impact, impact first |
| `startDate` | string, `YYYY-MM` | yes | Month it started (or happened) |
| `endDate` | string, `YYYY-MM` | no | Month it finished; omit if ongoing or a single month. Must not be before `startDate` |
| `tags` | array of strings, max 10 | no | Skills, technologies, themes |
| `links` | array of `uri` strings, max 10 | no | Evidence: PRs, articles, demos, press |
| `createdAt` | string, `datetime` | yes | Record creation timestamp, set by the server |

Lexicon has no pattern constraint, so the `YYYY-MM` format is documented in the
schema's field descriptions and enforced by the shared validator.

### Ordering

"Most recent first" means sorting by `endDate`, falling back to `startDate`,
descending, with `createdAt` descending as the tiebreaker. Record keys reflect
creation time, not when the accomplishment happened, so clients fetch every
page and sort; they do not rely on `listRecords` order.

## Constraints & principles

- **Record data lives in AT Proto, nowhere else.** The PDS is the source of
  truth. The server holds only auth state (OAuth grants and a cached PDS
  session), which can be lost and recreated without losing any records.
- **Public records are public.** Anything saved is world-readable. The tools
  say so, and `add_accomplishment` is called only after I approve the exact
  text. No confidential client names or internal details.
- **Least privilege.** Use an app password, never my main account password. The
  token used to trigger portfolio rebuilds is scoped to the portfolio repo
  only. Secrets live in Worker / Actions secrets, never in the repo or logs.
- **Single-owner access.** The deployed MCP endpoint requires GitHub OAuth and
  admits only my GitHub account, checked by numeric user ID rather than
  username alone. An open write/delete endpoint to my repo is unacceptable.
- **Lexicon first.** The schema is designed and reviewed before the tools, and
  evolves compatibly (additive changes only once published).
- **Small and boring.** Prefer the fewest moving parts that satisfy the
  outcomes.
- **The site never breaks on the data.** A failed or empty fetch renders an
  empty or fallback state; it does not fail the portfolio build.

## Success criteria

- From a Claude conversation, I can say "save this accomplishment…", "list my
  accomplishments", and "delete that one", and the repo reflects it each time.
- The records can be fetched by an unauthenticated client using standard
  AT Proto repo read calls.
- Unauthenticated requests, and requests from any other GitHub user, cannot
  create or delete anything.
- The server is deployed and survives a redeploy with no record loss.
- After an add or delete, the portfolio rebuilds and shows the change.

## Decisions (resolved from v0.1 open questions)

| Question | Decision |
| --- | --- |
| Lexicon NSID | `com.jlawcordova.profile.accomplishment` (authority `profile.jlawcordova.com`; publishing via `_lexicon` DNS can come later) |
| Account / PDS | Existing account `jlawcordova.com` on bsky.social. The DID is resolved with `com.atproto.identity.resolveHandle`, not hardcoded |
| Hosting | Cloudflare Workers, Worker `jlawcordova-mcp`, KV namespace `jlawcordova-mcp-session` |
| MCP auth | GitHub OAuth via `@cloudflare/workers-oauth-provider`, only user `jlawcordova` |
| Update tool | Not in v1; delete + recreate |
| Record keys | Auto-generated TIDs |
| Drafts | No draft store. Drafts are shown in the conversation and written only after I approve them |
| Dates | `startDate` / `endDate` as `YYYY-MM` strings |
| Links | `links` array of URIs |
| Organization / role / project | Dropped from v1. Context that is safe to publish goes in `description`; fields can be added later |
| MCP server style | `createMcpHandler` (stateless). `McpAgent` is deprecated and feature-frozen |

## Open questions

None. Details are in [`spec.md`](spec.md).

## AI-native SDLC

All steps are done and the intent is closed.

1. **Intent** (this document) — done.
2. **Spec** — Lexicon JSON, MCP tool contracts (inputs/outputs/errors), auth
   design, and acceptance tests in [`spec.md`](spec.md) — done.
3. **Plan** — the build order in [`spec.md`](spec.md#8-build-order) — done.
4. **Implement & verify** — built against the spec with tests, including an
   end-to-end check against a real PDS — done.
5. **Deploy & operate** — server shipped and the success criteria above
   confirmed — done.
