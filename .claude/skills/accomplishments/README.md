# accomplishments skill

A Claude Code skill for my career accomplishments workflow. It drafts
accomplishments from my GitHub activity, lets me pick which to post in Claude
Code's selector, and saves the picked ones to my public AT Protocol repo, which
my portfolio at https://jlawcordova.com shows.

| File | What it is |
| --- | --- |
| [`SKILL.md`](SKILL.md) | The skill's instructions. |

## When it's used

When I ask "draft my accomplishments", Claude:

1. Checks that the `accomplishments` CLI is installed and signed in.
2. Reviews my last 7 days on GitHub with `gh` and skips work that's already
   saved (`accomplishments list`).
3. Shows up to 5 public-safe drafts in the selector.
4. Saves only the drafts I pick with `accomplishments add`. The Worker then
   rebuilds the portfolio.

In a run that isn't interactive, it lists the drafts and saves nothing.

```mermaid
flowchart LR
    Ask["'draft my accomplishments'"] --> Pre["Preflight<br/>accomplishments list"]
    Pre --> Gather["Gather with gh"]
    Gather --> Draft["Draft and dedupe"]
    Draft --> Pick["I pick in the selector"]
    Pick --> Save["accomplishments add"]
```

## Install

No connectors are needed. You need:

- **`gh`**, signed in to any GitHub account to read activity from.
- **The `accomplishments` CLI**, installed and signed in as `jlawcordova`.

Both come from the latest
[release](https://github.com/jlawcordova/jlawcordova-atproto/releases):

```sh
npm install -g https://github.com/jlawcordova/jlawcordova-atproto/releases/latest/download/accomplishments-cli.tgz
curl -sL https://github.com/jlawcordova/jlawcordova-atproto/releases/latest/download/accomplishments-skill.zip -o /tmp/accomplishments-skill.zip
unzip -o /tmp/accomplishments-skill.zip -d ~/.claude/skills
accomplishments login
```

[`docs/cli-setup.md`](https://github.com/jlawcordova/jlawcordova-atproto/blob/main/docs/cli-setup.md)
covers signing in, the permission rule for `accomplishments list`, installing
from a clone instead, and releasing. Sessions on this repo load the skill from
`.claude/skills/` without installing it.
