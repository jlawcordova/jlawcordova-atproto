---
name: accomplishments
description: J. Law Cordova's career accomplishments workflow in Claude Code. Use it to draft accomplishments from recent GitHub activity with `gh`, let J. Law pick which to post with the selector, and save the picked ones with the `accomplishments` CLI. Trigger on "draft my accomplishments", "weekly accomplishments", or a scheduled or headless run that asks for this skill.
---

# Accomplishments

J. Law Cordova (GitHub user `jlawcordova`) keeps a public record of career
accomplishments in an AT Protocol repo, and the portfolio at
https://jlawcordova.com shows them. Anything saved is PUBLIC.

The flow:
1. Gather J. Law's recent GitHub activity with `gh`.
2. Draft accomplishments, skipping work that's already saved.
3. J. Law picks drafts in Claude Code's selector (`AskUserQuestion`).
4. Save only the picked drafts with `accomplishments add`.

Tools used: the `gh` CLI and the `accomplishments` CLI (`list`, `add`,
`delete`). No connectors are needed. Every `accomplishments` command prints
JSON to stdout on success, and JSON with `error` and `message` to stderr on
failure. Exit codes: 0 success, 1 the API refused or failed, 2 bad usage,
3 not signed in or token rejected, 4 network error.

## 1. Preflight

- Run `accomplishments list --limit 1`.
  - Exit 3: tell J. Law to run `accomplishments login` and stop.
  - Command not found: say to install it with `npm link` from the
    `jlawcordova-cli` folder of the `jlawcordova-atproto` repo (see
    `docs/cli-setup.md` there), and stop.
  - Exit 4: the Worker can't be reached. Say so and stop.
- Run `gh auth status` to find the active GitHub account. Name that account in
  the report. Any account is fine to read from: work and personal accounts
  can describe the same work, and J. Law accepts or edits every draft.

## 2. Gather

With `gh`, review the past 7 days (up to now) for the active account:
- Pull requests opened or merged: `gh search prs --author @me
  --created ">=<date>"` and `gh search prs --author @me --merged-at ">=<date>"`.
- Reviews given on other people's pull requests: `gh search prs
  --reviewed-by @me --updated ">=<date>"` (count them).
- Issues opened or closed: `gh search issues --author @me --created
  ">=<date>"` and `gh search issues --involves @me --closed ">=<date>"`.
- Releases and notable commits pushed directly to default branches: `gh api`
  (for example `gh api "/users/<login>/events?per_page=100"` for `PushEvent`
  and `ReleaseEvent`).

Read PR bodies (`gh pr view`) where the title alone doesn't say what the work
achieved.

## 3. Avoid duplicates

Run `accomplishments list --since <YYYY-MM, 3 months before today>`. Don't
draft work those records already cover. Work declined in an earlier run may
be drafted again; that's accepted.

If there was little or no activity, or nothing new to draft, say so and stop.
Don't pad the week with weak drafts.

## 4. Draft

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

Don't send `createdAt`; the Worker sets it.

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
- Reference example of a saved record J. Law approved:
  "My portfolio site, recently moved to Astro, now updates itself: I can ask
  an AI assistant to add or remove a career accomplishment, and it appears on
  the site without any manual editing. Behind it is a small Cloudflare
  service, locked to my GitHub account, that saves each accomplishment as a
  public record on the AT Protocol (the open network behind Bluesky) and then
  triggers the site to rebuild."

## 5. Keep it public-safe

Work in private repositories is often for clients or an employer. For every
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

If something can't be described safely, leave it out. The same rules apply
to everything shown in the selector.

## 6. Choose

If the session isn't interactive (a scheduled or headless run, or
`AskUserQuestion` isn't available), skip to step 8.

Ask with `AskUserQuestion`, `multiSelect: true`:
- One option per draft. The label is a short title (at most 5 words). The
  description holds the full title, description text, dates, tags, and links.
- A question holds at most 4 options, so 5 drafts become two questions (for
  example, drafts 1 to 3 and 4 to 5).
- The built-in **Other** is how J. Law gives exact text. If what's typed is a
  complete accomplishment, use it as given. If it's an instruction ("make #2
  shorter"), apply it. Either way, show the final text of every field and ask
  again before saving, unless the typed text is an exact replacement.

Nothing is saved for drafts that weren't picked.

## 7. Save

For each approved draft, in order, pipe one JSON object to `add`:

```sh
accomplishments add <<'EOF'
{"title": "...", "description": "...", "startDate": "YYYY-MM", "tags": ["..."], "links": ["..."]}
EOF
```

Use the exact approved text. On exit 1 with a 422, show the listed `errors`,
fix only what they name, show the fixed text, and ask before trying again.

Report each saved title with its `rkey`, and say if any `rebuild` isn't
`"triggered"` (a value starting with `failed:` means the portfolio wasn't
rebuilt). Never run `accomplishments delete` unless J. Law asks for it.

## 8. Not interactive

Show the drafts as a numbered list with every field, name the GitHub account
that was read, and stop. Nothing can be selected, so nothing is saved.
