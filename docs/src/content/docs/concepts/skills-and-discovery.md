---
title: Skills & discovery
description: What a skill is, and how Skiller discovers workspace, user, and built-in skills.
sidebar:
  order: 1
---

A **skill is a folder.** It holds a `skill.yaml` manifest and the Markdown step files the
manifest references — one prompt file per `llm` (and `confirmation`) step. Nothing else is
required:

```text
.skiller/skills/greeter/
├── skill.yaml          # the manifest
└── steps/
    ├── 01-greet.md     # a Liquid-templated prompt
    └── 02-fact.md
```

Skiller scans for these folders at startup (and on demand), parses each manifest with a
strict schema, and registers the result so you can launch it from chat as
`@skiller /skill <id>`.

## The folder name is the default `id`

A skill's `id` is what you type to run it and what discovery uses to deduplicate across
tiers. If the manifest omits `id`, Skiller uses the **folder name** as the `id`. The folder
above registers as `greeter` even with no `id:` line in `skill.yaml`. Set `id` explicitly in
the manifest only when you want it to differ from the folder name — and keep it stable, since
changing it changes how the skill is launched and which skills it overrides.

## Three-tier discovery

Skiller looks in three locations, in this precedence order. **Earlier wins:** when the same
`id` appears in more than one tier, the higher tier shadows the lower ones.

| Precedence | Tier | Location | What it's for |
| ---------- | ---- | -------- | ------------- |
| 1 (highest) | **Workspace** | `.skiller/skills/` in the workspace root | Skills that belong to *this* project — checked into the repo and shared with the team. |
| 2 | **User** | `~/.vscode/skiller/skills/` | Your personal skills, available across every workspace. |
| 3 (lowest) | **Built-in** | `skills/` shipped with the extension | The built-in example skills (`greeter`, `mind-reader`) you get out of the box. |

So a workspace skill overrides a user skill of the same `id`, which in turn overrides a
built-in one. Each tier is scanned independently; folders whose names start with `.` and
`node_modules` are skipped, and a folder without a `skill.yaml` is simply ignored rather than
treated as a broken skill.

## Forking a built-in skill

Because higher tiers win, **reusing an `id` is how you fork.** To customize a built-in
example, copy its folder into a higher tier — typically `.skiller/skills/<id>/` — keep the
same `id`, and edit your copy. Your version takes over wherever that workspace (or user
profile) is active, while the original stays untouched. It is the quickest way to start from
something that already runs end to end.

```text
.skiller/skills/greeter/skill.yaml   # your fork — id: greeter, overrides the built-in
```

The same mechanism lets you pin a project-specific variant in the workspace while keeping a
general-purpose version in your user tier.

## What `/reload` re-scans

Discovery is cached after the first scan, so newly added or edited skills are not picked up
automatically. Run `@skiller /reload` to re-scan **all three tiers** from disk. It reports a
diff of what changed — skills added, skills removed, and any manifests that started or stopped
failing to parse — so you can confirm your edit landed (and which tier it resolved from) without
restarting VS Code. See the [Commands reference](../../reference/commands/) for the full
behavior of `/reload`.

---

**Next:** [Step types & state](../step-types/) — how the steps inside a `skill.yaml` run and
pass data through `outputs`.

For the full manifest field list, see the
[`skill.yaml` reference](../../reference/skill-yaml/), and for the authoring walkthrough see
[Write your first skill](../../getting-started/write-your-first-skill/).

When a freshly added skill does not appear, or resolves from the wrong tier, the
[Debug a skill](../../guides/debugging/) guide walks through `/reload` and the other ways to
confirm what discovery picked up.
