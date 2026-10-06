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

Besides done accomplishments, J. Law can keep locked ones: goals he hasn't
reached yet (`done: false`). A drafting run also offers to mark a locked goal
done when recent work matches it, and to delete goals that have gone stale.

Tools used: the `gh` CLI and the `accomplishments` CLI (`list`, `add`,
`update`, `delete`), plus one fetch of the icon list. No connectors are
needed. Every `accomplishments` command prints
JSON to stdout on success, and JSON with `error` and `message` to stderr on
failure. Exit codes: 0 success, 1 the API refused or failed, 2 bad usage,
3 not signed in or token rejected, 4 network error.

## 1. Preflight

- Run `accomplishments list --limit 1`.
  - Exit 3: tell J. Law to run `accomplishments login` and stop.
  - Command not found: say to install it with
    `mkdir -p ~/.local/bin && curl -fsSL https://github.com/jlawcordova/jlawcordova-atproto/releases/latest/download/accomplishments-darwin-arm64 -o ~/.local/bin/accomplishments && chmod +x ~/.local/bin/accomplishments`
    (an Apple Silicon Mac, with `~/.local/bin` on the `PATH`;
    `docs/cli-setup.md` in that repo has the details), then run
    `accomplishments login`, and stop.
  - Exit 4: the Worker can't be reached. Say so and stop.
- Run `accomplishments --help`. It exits 2, which is expected here; read the
  usage text, which it prints on stderr. If it doesn't list `update`, the CLI is older than 1.1.0: say to
  remove the old npm install with `npm uninstall -g jlawcordova-cli`, install
  the latest release with the `curl` command above, and stop.
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

The list always includes every locked record (`done: false`), whatever
`--since` is. Keep them apart from the done ones:
- A locked record that matches recent activity is not a duplicate. It is a
  candidate to mark done (see "Marking a goal done" in step 4).
- A locked record whose `createdAt` is more than 14 days before now is stale
  (see "Stale goals" in step 4).

If there was little or no activity, nothing new to draft, no goal to mark
done and no stale goal, say so and stop. Don't pad the week with weak drafts.

## 4. Draft

Draft 3 to 5 accomplishments (fewer is fine if the week was light). Group
related work into one accomplishment rather than listing PRs one by one.
Prefer outcomes that matter: shipped features, fixed incidents, improved
processes, unblocked people, mentoring, reviews.

Icons: fetch `https://jlawcordova.com/achievement-icons.json` once per run
(for example `curl -fsS`) and choose each draft's icon from it by meaning. If
it can't be fetched, use the built-in list below and say so. If nothing fits,
pick the closest and say so.

| Icon | Meaning |
| --- | --- |
| sprout | started something, or a first |
| hammer | built something |
| rocket | shipped or launched |
| bug | fixed a bug or a problem |
| shield | secured or protected |
| key | opened access or a way in |
| wrench | tuned, sped up or automated something |
| book | wrote or documented |
| magnifier | investigated or analysed |
| flask | experimented or prototyped |
| apple | mentored or taught others |
| heart | helped, or went the extra mile |
| signpost | planned, led or set direction |
| chest | organised or stored (data, assets) |
| trophy | reached a milestone |
| speech | shared or presented |

Fields:
- title: a short headline, at most 200 characters.
- funTitle: the playful name, one to three words, at most 60 characters. See
  "Voice" below.
- shortDescription: a plain hint under the fun title, five to seven words, at
  most 80 characters.
- icon: one icon ID from the list above.
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

Don't send `createdAt`; the Worker sets it. Don't send `done` for a finished
accomplishment; absent means done.

### Voice

Fun titles are one to three words, warm, with light wordplay, in the way
Stardew Valley's achievements are: "Greenhorn" for earning 15,000g and
"Cowpoke" for 50,000g, each with a plain hint beneath.
- Never use a joke that needs explaining.
- Never overstate the work. A small fix is not a "Legend".
- The short description says plainly what happened, so the fun title can be
  playful. Where a fun title and the plain title disagree, J. Law decides.

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

### Goals (locked accomplishments)

When J. Law asks for one ("add a goal: ..."), skip steps 2 and 3, though
preflight and the icon list still apply. Draft a record with `done: false`,
a `title`, `description`, `funTitle`, `shortDescription` and `icon`, and no
`startDate` or `endDate`. Write the description as what the goal is for, in
the future tense. Show every field and ask for approval with
`AskUserQuestion` before saving it with `add` (step 7). A goal follows the
public-safe rules in step 5 and never names unannounced work.

### Marking a goal done

When recent activity matches a locked record, offer in the selector (step 6)
to mark it done. Never do it without J. Law's choice. Marking done is an
`update` that sets `done: true` and its date (step 7). Offer a better
`description` too if the finished work reads differently, but change only what
J. Law approves.

### Stale goals

List the locked records whose `createdAt` is more than 14 days before now and
propose deleting them, in a question of their own (step 6). Only the ones J.
Law confirms are deleted.

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
to everything shown in the selector, including fun titles, short descriptions
and goals. A goal never names unannounced work.

## 6. Choose

If the session isn't interactive (a scheduled or headless run, or
`AskUserQuestion` isn't available), skip to step 8.

Ask with `AskUserQuestion`, `multiSelect: true`:
- One option per draft. The label is the fun title. The description starts
  with the short description and the icon ID, then holds the plain title,
  description text, dates, tags, and links.
- One option per locked record that recent work matches: "Mark done: <fun
  title>", with the proposed month and any new description text. Choosing it
  means `update`.
- A question holds at most 4 options, so 5 drafts become two questions (for
  example, drafts 1 to 3 and 4 to 5).
- Stale goals get their own multi-select question, "Delete these stale
  goals?", one option per stale record showing its fun title, plain title and
  `createdAt`. Nothing is pre-selected.
- The built-in **Other** is how J. Law gives exact text. If what's typed is a
  complete accomplishment, use it as given. If it's an instruction ("make #2
  shorter"), apply it. Either way, show the final text of every field and ask
  again before saving, unless the typed text is an exact replacement.

Nothing is saved, updated or deleted for options that weren't picked.

## 7. Save

For each approved draft, in order, pipe one JSON object to `add`:

```sh
accomplishments add <<'EOF'
{"title": "...", "funTitle": "...", "shortDescription": "...", "icon": "...", "description": "...", "startDate": "YYYY-MM", "tags": ["..."], "links": ["..."]}
EOF
```

For an approved goal, the object has `"done": false` and no dates:

```sh
accomplishments add <<'EOF'
{"done": false, "title": "...", "funTitle": "...", "shortDescription": "...", "icon": "...", "description": "..."}
EOF
```

For each locked record J. Law chose to mark done, pipe a patch to `update`
with its `rkey`. Send only the fields that change, with the month the work
happened:

```sh
accomplishments update <rkey> <<'EOF'
{"done": true, "startDate": "YYYY-MM"}
EOF
```

For each stale goal J. Law confirmed, run `accomplishments delete <rkey>`.

Use the exact approved text. On exit 1 with a 422, show the listed `errors`,
fix only what they name, show the fixed text, and ask before trying again.

Report each saved, updated or deleted title with its `rkey`, and say if any
`rebuild` isn't `"triggered"` (a value starting with `failed:` means the
portfolio wasn't rebuilt). Never run `accomplishments delete` unless J. Law
asks for it or confirmed that stale goal in the selector. Never run `update`
unless J. Law chose it.

## 8. Not interactive

Show the drafts as a numbered list with every field, then any locked records
that look done and any stale goals, name the GitHub account that was read, and
stop. Nothing can be selected, so nothing is saved, updated or deleted.
