---
title: Commands
description: Every Skiller command, editor entry point, and language-model tool.
sidebar:
  order: 3
---

Skiller runs skills natively in VS Code. You drive it from the Command Palette, the editor, and the
graph panel; Copilot can drive it through two language-model tools. For how a run behaves once it
starts — inputs, cards, tool approvals, results — see [Running skills](../../guides/running-skills/).

## Command Palette

| Command | What it does |
| ------- | ------------ |
| **Skiller: Run Skill…** (`skiller.runSkill`) | Pick a skill and run it. Captures the editor state first, so `from:` inputs and `output.to` sinks use where you started. |
| **Skiller: New Skill…** (`skiller.newSkill`) | Create a skill: **Describe it** (runs the built-in `skill-creator`), **From a template**, or **Copy a skill**. See [Create a skill](../../getting-started/create-a-skill/). |
| **Skiller: Show Skills** (`skiller.showSkills`) | Pick a skill, then **Run**, **Show Graph**, or — for a built-in — **Copy to Workspace…**. |
| **Skiller: Cancel Run** (`skiller.cancelRun`) | Cancel the running skill (same as **Cancel** on its progress notification). |
| **Skiller: Reload Skills** (`skiller.reloadSkills`) | Re-scan skills and tools, refresh open graphs, and report how many skills were added or removed, and any parse errors. |
| **Skiller: Reset Tool Approvals** (`skiller.resetToolApprovals`) | Forget every **Always allow in this workspace** choice, so every tool asks again. |

`skiller.copySkill` (**Copy Skill to Workspace…**) is what **Copy** runs. It is hidden from the
palette: reach it through **Show Skills** or **New Skill… → Copy a skill**.

## In the editor

| Entry point | What it does |
| ----------- | ------------ |
| **Editor context menu → Run Skill…** | Same as the palette command, from a right-click in any file. |
| **Code action: Skiller: Run ‹skill›** | Offered in the lightbulb / quick-fix menu for skills whose [`from:` inputs](../skill-yaml/#binding-inputs-to-editor-context) match the current selection, file, or diagnostics; runs that skill directly. |
| **Show Graph** CodeLens | Above every `skill.yaml`: opens the skill's [live execution graph](../../concepts/execution-graph/). |

When a skill is created, a notification offers **Run it now** and **Reveal in Explorer**.

## Copilot

| Surface | What it does |
| ------- | ------------ |
| **`/skiller`** in Copilot chats | Added by Skiller's chat plugin: asks Copilot to find and run one of your workflows. Unrelated to Copilot's own `/skills` commands. |
| `skiller_listSkills` (`#listSkills`) | Lists the workflows available in this window, with their inputs. |
| `skiller_runSkill` (`#runSkill`) | Runs a workflow by id. Always asks you first; waits up to 10 minutes for the result, then the run continues in VS Code. |

See [Use Skiller from Copilot](../../guides/use-from-copilot/).

## The removed `@skiller` chat commands

Skiller 0.5.0 removed the `@skiller` chat participant and its slash commands (`/skill`, `/skills`,
`/new`, `/reload`, `/cancel`, `/reset`, `/status`, `/models`, `/tools`, `/help`). The
[table in Running skills](../../guides/running-skills/#coming-from-the-skiller-chat-commands) maps
each one to its replacement.

## Next

- [Run a built-in skill](../../getting-started/run-a-bundled-skill/) — try **Run Skill…** end to end.
- [Settings](../settings/) — the fallback model, file-tool confinement, and agentic-loop limits.
