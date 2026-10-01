# Intent: Accomplishments on AT Protocol

> Status: Draft v0.1 — Owner: J. Law Cordova — Date: 2026-10-01

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
reachable remotely.

The records are the product. The portfolio website is a *future consumer* and is
explicitly out of scope for now — but every decision here should keep that
consumer easy to build.

## Outcomes (what "done" looks like)

1. An **accomplishment Lexicon** exists under a namespace I control
   (derived from `jlawcordova.com`) and describes a single accomplishment.
2. I can **write** an accomplishment and it appears as a record in my AT Proto
   repo.
3. I can **list** my accomplishments and get them back in a stable, sensible
   order (most recent first).
4. I can **delete** an accomplishment by its record key and it is gone from my
   repo.
5. These three operations are exposed as **MCP tools** on a **deployed server**,
   so I can use them from Claude (and any other MCP client) from anywhere.
6. A portfolio site can later read the same records **directly from the public
   repo** with no changes to this system.

## Scope

### In scope
- Lexicon definition for an accomplishment record.
- MCP server with three tools: `create`/write, `list`, `delete`
  (update/edit is a natural fourth; see open questions).
- Authentication of the server to my PDS, and protection of the MCP endpoint so
  that only I can write or delete.
- Deployment of the MCP server to a hosted environment.
- Basic input validation against the Lexicon.

### Out of scope (for now)
- The portfolio website itself.
- Importing/backfilling historical accomplishments (can be done later *through*
  the MCP tools).
- Multi-user support — this is a single-owner system.
- Rich media attachments (images, blobs) on accomplishments.
- Search, tagging UI, analytics, or any non-AT-Proto storage.

## Draft record shape (to be refined in the spec)

An accomplishment is likely to carry:

| Field | Notes |
| --- | --- |
| `title` | Short headline of the accomplishment (required) |
| `description` | What I did and the impact (required) |
| `organization` | Employer / client / project context |
| `role` | My role at the time |
| `startDate` / `endDate` | When it happened (month precision is fine) |
| `tags` | Skills/technologies/themes, for filtering on the portfolio |
| `links` | Evidence: PRs, articles, demos, press |
| `createdAt` | Record creation timestamp |

## Constraints & principles

- **Data lives in AT Proto, nowhere else.** The server is stateless; the PDS is
  the source of truth.
- **Public records are public.** Anything saved is world-readable. The tools
  should make this obvious so I don't publish confidential work details by
  accident.
- **Least privilege.** Use an app password / scoped credential, never my main
  account password; keep secrets out of the repo.
- **Single-owner access.** The deployed MCP endpoint must require
  authentication; an open write/delete endpoint to my repo is unacceptable.
- **Lexicon first.** The schema is designed and reviewed before the tools, and
  evolves compatibly (additive changes only once published).
- **Small and boring.** Prefer the fewest moving parts that satisfy the
  outcomes.

## Success criteria

- From a Claude conversation, I can say "save this accomplishment…", "list my
  accomplishments", and "delete that one", and the repo reflects it each time.
- The records can be fetched by an unauthenticated client using standard
  AT Proto repo read calls.
- Unauthenticated requests to the MCP server cannot create or delete anything.
- The server is deployed and survives a redeploy with no data loss (because it
  holds no data).

## Open questions

1. **Lexicon NSID** — `com.jlawcordova.accomplishment`? (Requires the domain
   `jlawcordova.com` as the namespace authority; confirm and consider publishing
   the lexicon via the `_lexicon` DNS/record mechanism.)
2. **Which account/PDS** — is the target my existing Bluesky account or a
   dedicated one? Handle/DID to use?
3. **Hosting target** — Cloudflare Workers is the leading candidate (remote MCP
   support, cheap, stateless). Confirm or choose otherwise.
4. **MCP auth model** — OAuth, or a static bearer token for a single-owner
   server?
5. **Update tool** — include an `update` tool now, or rely on delete + recreate
   for v1?
6. **Record keys** — auto-generated TIDs, or human-readable slugs derived from
   the title?
7. **Visibility of drafts** — all records are public; do I need a way to hold
   unpublished drafts elsewhere before writing?

## Next steps in the AI-native SDLC

1. **Intent** (this document) — review and resolve the open questions.
2. **Spec** — Lexicon JSON, MCP tool contracts (inputs/outputs/errors), auth
   design, and acceptance tests in a `spec.md`.
3. **Plan** — break the spec into small, verifiable tasks.
4. **Implement & verify** — build against the spec with tests, including an
   end-to-end check against a real PDS.
5. **Deploy & operate** — ship the server and confirm the success criteria
   above.
