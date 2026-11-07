---
title: Use Skiller from Copilot
description: Let GitHub Copilot list and run your Skiller workflows — with the /skiller command or by asking — while every run stays reviewable in VS Code.
sidebar:
  order: 2
---

Copilot can run your skills for you. Ask it to — "run my changelog skill on the staged diff" — and
it finds the matching Skiller workflow, asks you to approve the run, and reports the result back in
chat. The run itself happens in VS Code exactly as if you had started it with **Skiller: Run
Skill…**: inputs, confirmations, and tool approvals are still yours to answer.

## Two ways in

- **`/skiller`** — Skiller ships a chat plugin that adds `/skiller` to Copilot chats. It tells
  Copilot how to find and run your workflows, so `/skiller summarize this file` is the most direct
  way to ask.
- **Just ask** — the plugin's description lets Copilot pick it up on its own when you mention Skiller
  skills or workflows. You can also reference the tools directly with `#listSkills` and `#runSkill`.

Copilot calls tools in agent mode, so use agent mode for both. `/skiller` requires a VS Code version
with agent-plugin support (verified on VS Code 1.145); on older versions Skiller works but `/skiller`
doesn't appear, so ask Copilot directly or reference `#runSkill`.

:::note[Not Copilot's `/skills`]
Copilot has its own `/skills` commands (add, info, list, reload, remove). They manage Copilot's
agent skills and have nothing to do with Skiller workflows. Use `/skiller` for Skiller.
:::

## The tools

Skiller contributes two language-model tools that Copilot (or any agent) can call:

| Tool | What it does |
| ---- | ------------ |
| `skiller_listSkills` (`#listSkills`) | Lists the workflows available in this window: each one's id, name, description, inputs (with which are filled from the editor), and whether it writes its result back into the editor. Skills that could not run from here are left out: any skill, built-ins included, that uses a chat-only tool or `skiller_runSkill` / `skiller_listSkills` (which can't be used inside a Skiller run), and workspace or user skills that use a built-in-only tool. |
| `skiller_runSkill` (`#runSkill`) | Runs a workflow by id, with optional input values, and returns its result summary. |

## What happens when Copilot runs a skill

1. **You approve the run.** `skiller_runSkill` always asks first — **Run Skiller skill** — showing
   the skill and, as JSON, any input values Copilot filled in. Nothing starts until you allow it.
2. **Missing inputs are asked in VS Code.** Inputs bound to the editor (`from:`) are filled from the
   active editor; other required inputs Copilot didn't supply are asked with the usual pickers.
3. **The run is a normal native run.** It shows a progress notification, pauses on cards in the
   [graph panel](../../concepts/execution-graph/), and asks before each tool, just like
   [any other run](../running-skills/).
4. **Copilot reports the result.** The tool returns the summary (or why the run failed, was
   cancelled, or didn't start), plus where an `output.to` sink delivered it.

Copilot waits for up to **10 minutes**. If the run is still going — say, a confirmation card you
haven't answered — the tool returns early with *"The run continues in VS Code; see the graph panel
for the result."* The run keeps going, and its result appears in VS Code.

Only one skill runs at a time. If one is already running, VS Code asks whether to cancel it and run
the new one.

## Related

- [Running skills](../running-skills/) — inputs, cards, tool approvals, and results.
- [Commands](../../reference/commands/) — every command and tool Skiller adds.
- [Built-in tools](../../reference/built-in-tools/) — Skiller's file and skill tools.
