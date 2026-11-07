---
title: Create a skill
description: Start a new skill three ways — describe it to the built-in skill creator, scaffold from a template, or copy a working example.
sidebar:
  order: 4
---

You don't have to start from a blank file. Skiller can scaffold a skill for you, and every path ends
the same way: a validated folder under `.skiller/skills/<id>/`, with its `skill.yaml` and
[execution graph](../../concepts/execution-graph/) opened so you can see what you got.

Start with:

```text
@skiller /new
```

You get three links — **✎ Describe it**, **▤ From a template**, and **⎘ Copy a skill**. The
Command Palette offers the same three choices through **Skiller: New Skill…**.

## Path 1: Describe it

Pick **Describe it**, or skip the links and pass the idea directly:

```text
@skiller /new summarize a pull request and draft a changelog entry
```

Everything after `/new` is taken as one free-text idea. This runs the built-in `skill-creator`
skill: it drafts a plan, pauses so you can approve or refine it, then writes the skill files.
The skill creator only uses tools that are actually installed — it reads the list of available
tools first. If the plan isn't what you meant, cancel and run `/new` again with a sharper
description.

## Path 2: From a template

Pick **From a template**, choose one, and give the new skill an id. Skiller fills in the id and
display name for you.

| Template | What it gives you |
| -------- | ----------------- |
| `basic` | Ask for text, summarize it with one `llm` step |
| `approval` | Draft something, pause for your approval, then polish it |
| `loop` | Brainstorm and keep asking for more until you stop |
| `tool` | Write notes and save them to a file with a tool |
| `editor` | Rewrite the selected text in the editor |

If the id is already taken you are asked for another.

## Path 3: Copy a skill

Pick **Copy a skill** (same label in the Command Palette) to copy a
working skill into your workspace: the examples `change-map`, `shell-it`, and `smell-refactor`, or
the built-ins `greeter` and `mind-reader`. You can also click **⎘ Copy** next to a built-in in the
`/skills` list. `skill-creator` is not offered: it uses `skiller_writeSkill`, which only built-in
skills may call, so a copy could not run.

- **An example** keeps its id when that id is free. If the id is already taken, you are asked for a
  new one (`<id>-copy` is suggested), and the copy's `id` and `name` are rewritten to match.
- **A built-in** keeps its id, so your copy **overrides** the built-in wherever your workspace is
  active, and Skiller tells you so. If a folder with that id already exists, you are asked for a new
  id instead, and the copy no longer overrides.

## Where it is written, and the rules

- Skills go to `.skiller/skills/<id>/` in the open workspace. With no workspace open, they go to your
  user folder, `~/.vscode/skiller/skills/`.
- Ids are unique across all tiers, ignoring case. The one exception is copying a built-in, which
  deliberately reuses the id.
- Whatever the path, the skill is validated with the same checks as `/skill` **before** anything is
  written, so a broken skill never lands on disk. One difference: a copy or template is not refused
  because a tool it uses isn't installed (you are copying it to edit); that check runs when you start
  the skill.

## After it's created

`skill.yaml` and the skill's graph open, and a notification offers **Run it now** and
**Reveal in Explorer**.

---

Next: [Write your first skill →](../write-your-first-skill/) to understand what the scaffold
produced, or see the [Commands reference](../../reference/commands/).
