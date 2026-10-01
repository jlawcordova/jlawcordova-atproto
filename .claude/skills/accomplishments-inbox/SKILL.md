---
name: accomplishments-inbox
description: J. Law Cordova's career accomplishments workflow. Use it to draft accomplishments from his recent GitHub activity into his private "Accomplishments Inbox" artifact, publishing the inbox first if he doesn't have one yet. Trigger on "draft my accomplishments", "weekly accomplishments", or a scheduled task that asks for this skill.
---

# Accomplishments Inbox

J. Law Cordova (GitHub user `jlawcordova`) keeps a public record of career
accomplishments in his AT Protocol repo, and his portfolio at
https://jlawcordova.com shows them. Anything posted is PUBLIC.

The flow:
1. This skill drafts accomplishments from his GitHub activity and writes
   them to the private Accomplishments Inbox artifact, publishing the inbox
   first if it doesn't exist yet.
2. He opens the inbox, picks drafts, optionally adds notes for Claude to apply,
   reviews the final text, and posts them from the page.

Claude never posts accomplishments directly, except in the fallback described
in step 6.

Connectors used: GitHub, and his accomplishments connector (tools
`list_accomplishments`, `add_accomplishment`, `delete_accomplishment`).

## 1. Find or prepare the inbox

The inbox URL: use the one given in the request. If there isn't one, list his
artifacts and find the one titled "Accomplishments Inbox". The original is
<INBOX_URL> (if that still reads `<INBOX_URL>`, it wasn't filled in at
install time, so find the inbox by title).

Reuse the existing inbox if he can open it. Otherwise, publish a new one:
- Read `assets/accomplishments-inbox.html` in this skill. Before publishing,
  set the `SERVER` constant at the top of its script to the accomplishments
  connector's display name as it appears in claude.ai (currently assumed to
  be "jlawcordova AT Proto"; in a live conversation, ask him if unsure).
- Publish it with these capabilities, using the same connector name:
  ```
  {db: {rules: [{path: "", read: "owner", write: "owner"}]}, user: {},
   sample: {}, mcp: {servers: [{server: "<connector display name>",
   tools: ["add_accomplishment"]}]}}
  ```
  Only he can read or write its data.
- Check once that collection "drafts" can be read, then continue with that
  URL. Tell him the new URL in the report (step 6).

What the page does:
- Lists pending drafts by week, each with a checkbox and Dismiss. Posted and
  dismissed drafts go in a History list.
- Has an optional "Notes for Claude" box. Notes are applied to the selected
  drafts by the page's own Claude call. Links that weren't in the draft or
  the notes are removed.
- Shows the exact final text and validates every field before posting.
- Posts through `add_accomplishment` one at a time, marks each draft posted
  (status, rkey, rebuild, posted text, postedAt), and warns when `rebuild` is
  "failed".

If he asks for page changes, edit the HTML, republish to the same URL, and
keep the db document shape in step 5, because drafting depends on it.

## 2. Gather

Use the GitHub connector to review his activity over the past 7 days (up to
now):
- Pull requests he opened, merged, or that were merged.
- Reviews he gave on other people's pull requests (count them).
- Issues he opened, closed, or commented on substantively.
- Releases and tags he published.
- Notable commits pushed directly to default branches.

To avoid duplicates, also check:
- `list_accomplishments` with `since` set to the month 3 months before today
  (YYYY-MM). These are already posted.
- The inbox's existing drafts: `ArtifactData` action "list" on the inbox URL,
  collection "drafts". Don't re-draft work that already has a draft there,
  whatever its status (pending, posted or dismissed).

If there was little or no activity, or nothing new to draft, stop. Don't
write anything, and on a scheduled run don't notify him, unless step 1
published a new inbox: then tell him its URL. Don't pad the week with weak
drafts.

## 3. Draft

Draft 3 to 5 accomplishments (fewer is fine if the week was light). Group
related work into one accomplishment rather than listing PRs one by one.
Prefer outcomes that matter: shipped features, fixed incidents, improved
processes, unblocked people, mentoring, reviews.

Fields:
- title: a short headline, at most 200 characters.
- description: see "Description style" below. At most 1000 characters, but
  aim for about 2 sentences (roughly 300 to 400 characters).
- startDate: the month it started or happened, as YYYY-MM.
- endDate: only if it spans more than one month, as YYYY-MM, not before
  startDate. Otherwise omit it.
- tags: up to 10 short skills, technologies, or themes, no duplicates.
- links: up to 10 http(s) URLs as evidence, and only URLs that are publicly
  reachable (public repos, published articles, live demos). Never link to a
  private repository, its PRs, or its issues. Prefer the repository or the
  live site over individual pull request links.

### Description style

- Keep it short: about 2 sentences. Lead with what the work is used for and
  the impact it has (who it helps, what it makes possible, what it replaces
  or improves), then add one sentence on how it was built.
- Write so a non-technical reader can follow it. Avoid dense jargon,
  low-level implementation details, and long lists of internals. A few
  well-known technology names are fine; put the rest in tags.
- Don't count activity. Numbers like how many pull requests, commits, files,
  or tests are not impressive and should be left out. Use a number only when
  it describes real-world impact and the data supports it (for example, users
  served or time saved). Never invent numbers.
- Reference example of a posted record he approved:
  "My portfolio site, recently moved to Astro, now updates itself: I can ask
  an AI assistant to add or remove a career accomplishment, and it appears on
  the site without any manual editing. Behind it is a small Cloudflare
  service, locked to my GitHub account, that saves each accomplishment as a
  public record on the AT Protocol (the open network behind Bluesky) and then
  triggers the site to rebuild."

## 4. Keep it public-safe

Work in private repositories is often for clients or his employer. For every
draft:
- No client, customer, or employer-confidential names. No project codenames,
  internal system names, or repository names from private repos.
- No colleagues' names, handles, or anything else that identifies another
  person.
- No internal incidents, decisions, estimates, pricing, contracts, or
  processes.
- Describe private work by its kind ("an enterprise client platform", "a
  payment-sensitive browser extension"), not by who it was for or who was
  involved.

If something can't be described safely, leave it out.

The `source` field (below) is shown only in his private inbox, but keep it
free of client names and private repo names too: describe private work there
by its kind as well.

## 5. Write the drafts to the inbox

Write all drafts in one `ArtifactData` "batch" call to the inbox URL, one
"set" per draft, collection "drafts". Since these are new documents, omit
if_version.
- doc_id: "<today as YYYY-MM-DD>-<short-kebab-slug>", e.g.
  "2026-10-05-ci-cleanup". Letters, digits and hyphens only.
- data:
  ```
  {
    "week": "<today as YYYY-MM-DD>",
    "order": <1, 2, 3... in recommended order>,
    "status": "pending",
    "title": ..., "description": ..., "startDate": ...,
    "endDate": ... (only when needed),
    "tags": [...], "links": [...],
    "source": "<one line: which activity it came from>",
    "createdAt": "<now, ISO 8601>"
  }
  ```

Never change or delete existing drafts, and never call `add_accomplishment` or
`delete_accomplishment`. He posts from the inbox.

## 6. Report

On a scheduled run, after the batch succeeds, send a push notification. Put
the number of new drafts and their titles in it, and say they're waiting in
the Accomplishments Inbox (include the URL). In a live conversation, just say
the same thing in the reply.

If the inbox write fails (for example, `ArtifactData` isn't available or the
call errors), fall back:
1. Notify him that the inbox couldn't be updated and why.
2. Show the drafts in the session as a numbered list with every field.
3. Wait for his reply before doing anything else.
4. Save only drafts he explicitly approves, with exactly the text he
   approved, using `add_accomplishment`. If his edits are more than an exact
   replacement, show the final text and ask again.
5. Report the rkey of each saved record, and tell him if any result says
   `rebuild: failed`.
