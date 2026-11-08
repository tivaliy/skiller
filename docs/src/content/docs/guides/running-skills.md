---
title: Running skills
description: Run a skill from the status bar, the Command Palette, the editor, or a code action — and answer its inputs, confirmations, and tool approvals in VS Code.
sidebar:
  order: 1
---

Skills run **natively in VS Code**. You start one from the status bar, the Command Palette, the
editor, or a code action; Skiller asks for its inputs with pickers, shows progress in a notification, and pauses on
cards in the skill's [live execution graph](../../concepts/execution-graph/) whenever it needs you.
No chat is involved — though Copilot can [start your skills too](../use-from-copilot/).

## Start a run

| From | How |
| ---- | --- |
| **Status bar** | Click **Skiller** (bottom right) → pick a skill → **Run**. It opens **Show Skills**, below. |
| **Command Palette** | **Skiller: Run Skill…** → pick a skill. |
| **Editor context menu** | Right-click in a file → **Run Skill…**. |
| **Code action** | The lightbulb / quick-fix menu offers **Skiller: Run ‹skill›** for skills whose [`from:` inputs](../../reference/skill-yaml/#binding-inputs-to-editor-context) match the current selection, file, or diagnostics. |
| **Show Skills** | **Skiller: Show Skills** → pick a skill → **Run** (or **Show Graph**, or **Copy to Workspace…** for a built-in). |
| **After creating a skill** | **Skiller: New Skill…** ends with a notification offering **Run it now**. |
| **Copilot** | Ask Copilot in chat, or use `/skiller` — see [Use Skiller from Copilot](../use-from-copilot/). |

Whichever you use, Skiller captures the editor state at that moment — the selection, file, diff, or
diagnostics the skill declares — so `from:` inputs are filled from where you started, and an
[`output.to` sink](../../reference/skill-yaml/#output-sinks-outputto) writes back there even after
the run's pickers have taken focus. See [Editor-native skills](../../concepts/editor-native-skills/).

## Inputs

Inputs not filled from the editor are asked one at a time, with the input's `prompt` as the
question and its position in the title (`Greeter — name (1 of 1)`). A `default` is pre-filled. An
`enum` input is a pick list, a `boolean` input is **Yes** / **No**, and an optional input can be left
empty (**Skip** in a pick list). Pressing <kbd>Esc</kbd> on any input cancels the run before it
starts.

## The model

A step uses the model the skill names (per-step `model`, then `models.default`). For steps that name
none — or name one you don't have — Skiller uses a fallback model:

1. the [`skiller.model.default`](../../reference/settings/#skillermodeldefault) setting, if it names an
   installed model;
2. otherwise the model you picked last time;
3. otherwise it asks once (**Choose a model for Skiller runs**) and remembers your choice.

See [Use & override models](../models/).

## Watching a run

A progress notification titled with the skill's name shows the current step
(`Draft (2 of 4)`) and has a **Cancel** button. **Skiller: Cancel Run** does the same from the
Command Palette.

While a skill runs, the **Skiller** status bar item shows a spinner and the skill's name. Click it to
bring the skill's graph forward, for example when a card is waiting and you've moved to another
tab. To hide the item, right-click the status bar and uncheck **Skiller**.

The skill's graph opens beside your editor as soon as the run needs you, and lights up step by step.
To watch from the first step, open it before you start: the **Show Graph** CodeLens above the
`skill.yaml`, or **Skiller: Show Skills** → **Show Graph**.

Only one skill runs at a time: starting another while one is running asks whether to **Cancel and
run** the new one.

## Confirmations

A [`confirmation` step](../../concepts/step-types/) opens the graph and appears there as a **card**,
with its message and one button per option. The progress notification shows *Waiting for you*.
If the panel still can't be seen after it opens (for example, behind a maximized chat), a second
notification, **Skiller is waiting for you**, offers **Review** to bring it forward.

If the panel can't be shown, or you close it while the card is waiting, the confirmation falls
back to a modal dialog that shows the full message and the same options.

## Tool approvals

Outside chat, VS Code asks for no approval before a tool runs — so Skiller asks itself. The first
time a run calls a tool, a **tool-approval card** shows the tool and its input, with four choices:

| Choice | Effect |
| ------ | ------ |
| **Allow** | Run this call. The next call to the same tool asks again. |
| **Allow for this run** | Run this tool without asking again until the run ends. |
| **Always allow in this workspace** | Never ask about this tool again in this workspace. |
| **Deny** | Refuse the call. In an `llm` step the model is told the call was declined and carries on; a `tool` step fails. |

Skiller's own tools use their own wording — **Create File**, **Replace in File**, **Write Skiller
skill** — with a preview of what they will write. As with confirmations, if the panel can't be shown
or you close it, a modal asks with the same choices.

**Skiller: Reset Tool Approvals** forgets every **Always allow** choice, so every tool asks again.

## Results

When the run finishes:

- A skill with an [`output.to` sink](../../reference/skill-yaml/#output-sinks-outputto) delivers its
  summary there and tells you where (or that it opened a new tab because there was no safe place
  to write).
- Otherwise its summary appears as a **result card** in the graph, with **Open as document**,
  **Copy**, and **Show log**; with the panel closed, it opens as a document.
- A failed run says which skill failed and why, with **Show log**.

## The run log

Every run is also written, as it happens, to the **Skiller** output channel (**View → Output**, then
pick *Skiller*, or **Show log** on a result card or a failure). Runs Copilot starts are logged too.

```text
── Greeter · 18:00:42 ─────────────────────────────────────
inputs: name = "John"
▶ greet (1/3) · model gpt-5.6-luna (your model for Skiller runs)
  ✓ greet 2.1s → Hi John, wishing you a wonderful day…
▶ confirm (2/3)
  ? Confirm before generating fun fact → Yes, give me a fun fact
▶ fact (3/3) · model gpt-5.6-luna (your model for Skiller runs)
  ✓ fact 1.8s → Fun fact: "John" comes from a Hebrew name…
✓ Greeter completed in 6.4s
```

Each step shows its model and why it was chosen, how long it took, and the first line of what it
produced; tool calls, your answers on cards, skipped steps, and failures appear in order. A run that
ends without a result is marked **cancelled** or **stopped**. For a step's full prompt and response,
hover it in the graph and use **Open ↗**.

To keep the log next to the graph, click **Open Output in Editor** in the Output panel's toolbar: the
log opens as an editor tab that keeps updating, which you can drag beside the graph.

## Reloading skills

Skiller scans for skills at startup and when you create one. After adding or editing a skill on
disk, or starting an MCP server, run **Skiller: Reload Skills**: it re-scans skills and tools,
refreshes open graphs, and reports how many skills were added or removed and any parse errors.

## Coming from the `@skiller` chat commands

Skiller 0.5.0 removed the `@skiller` chat participant. Here is where each command went:

| Was | Now |
| --- | --- |
| `@skiller /skill <id>` | **Skiller: Run Skill…**, the editor context menu, a code action, or ask Copilot. Inputs are asked with pickers; Copilot can pass them for you. |
| `@skiller /skills` | **Skiller: Show Skills** (Run, Show Graph, Copy to Workspace…). |
| `@skiller /new` | **Skiller: New Skill…** |
| `@skiller /reload` | **Skiller: Reload Skills** |
| `@skiller /cancel`, `/reset`, `/status` | **Skiller: Cancel Run**, or **Cancel** on the progress notification. A run's state lives in its graph; there is nothing left to reset. |
| The chat transcript of a run | The [run log](#the-run-log) in the **Skiller** output channel. |
| `@skiller /models` | The model picker lists each model's id; set one in [`skiller.model.default`](../../reference/settings/#skillermodeldefault). |
| `@skiller /tools`, `/help` | No replacement. A skill that names a tool that isn't available refuses to start and names the tool. |
| The chat model dropdown overriding a skill's models | Gone: skills use the models they name, and the fallback model above for the rest. |
| `skiller.skills.runSurface` | Removed: every entry point runs the skill directly. |
| `skiller.skills.verboseMode` | Removed: the [run log](#the-run-log) shows each step's output in one line; hover a step in the graph for its full prompt and response — see [Debug a skill](../debugging/). |

## Related

- [Commands](../../reference/commands/) — every command Skiller adds.
- [Use Skiller from Copilot](../use-from-copilot/) — run skills from Copilot chat.
- [The execution graph](../../concepts/execution-graph/) — the panel the cards appear in.
