---
title: Create a skill
description: Start a new skill three ways — describe it to the built-in skill creator, scaffold from a template, or copy a working example.
sidebar:
  order: 4
---

You don't have to start from a blank file. Skiller can scaffold a skill for you, and every path ends
the same way: a validated folder under `.skiller/skills/<id>/`, with its `skill.yaml` and
[execution graph](../../concepts/execution-graph/) opened so you can see what you got.

Run **Skiller: New Skill…** from the Command Palette. It asks how you want to start: **Describe
it**, **From a template**, or **Copy a skill**.

## Path 1: Describe it

Pick **Describe it** and type the workflow you want — for example, *summarize a pull request and
draft a changelog entry*. This runs the built-in `skill-creator` skill like any other
[native run](../../guides/running-skills/):

1. It drafts a plan and shows it as a card in the skill's graph.
2. You choose **Build it**, **Make it simpler**, **Add a review step before anything is applied**
   (both send it back to re-plan), or **Cancel**.
3. On **Build it** it writes the skill files with `skiller_writeSkill`. That write needs no extra
   approval: you already approved the plan.

The skill creator only uses tools that are actually installed — it reads the list of available
tools first. If the plan isn't what you meant, cancel and describe it again more sharply.

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
the built-ins `greeter` and `mind-reader`. You can also pick a built-in in **Skiller: Show Skills**
and choose **Copy to Workspace…**. `skill-creator` is not offered: it uses `skiller_writeSkill`, which only built-in
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
- Whatever the path, the skill is validated with the same checks as a run **before** anything is
  written, so a broken skill never lands on disk. One difference: a copy or template is not refused
  because a tool it uses isn't installed (you are copying it to edit); that check runs when you start
  the skill.

## After it's created

`skill.yaml` and the skill's graph open, and a notification offers **Run it now** and
**Reveal in Explorer**.

---

Next: [Write your first skill →](../write-your-first-skill/) to understand what the scaffold
produced, or see the [Commands reference](../../reference/commands/).
