---
title: Editor-native skills
description: How skills read your editor and write back to it — context inputs, output sinks, launch surfaces, and the safety model behind them.
sidebar:
  order: 5
---

A skill can **read** your editor — the selection, the
current file, a git diff, the problems list — to fill its inputs, and it can **write its result
back** — to a new document, a file, your selection, a diff, or the terminal. That's an
*editor-native* skill: you launch it from where you're working, and the result lands where you
expect it.

Two manifest fields turn an ordinary skill into an editor-native one:

- [`inputs[].from`](../../reference/skill-yaml/#binding-inputs-to-editor-context) — fill an input from editor context instead of prompting.
- [`output.to`](../../reference/skill-yaml/#output-sinks-outputto) — deliver the finished result to a destination instead of the result card.

Neither is required, and they're independent: a skill can read context without an output sink, route
output without binding context, or do both.

## The shape of a run

When you launch a skill from the editor, four things happen in order:

1. **Capture** — Skiller snapshots the editor state *at that moment*: the selection, file, diffs, and
   diagnostics the skill declares it needs (and only those).
2. **Launch** — the skill starts as a [native run](../../guides/running-skills/).
3. **Run** — `from:` inputs are filled from the snapshot; anything not bound, or empty, is collected
   the normal way (default, or an input box / picker).
4. **Deliver** — when the skill finishes, its rendered `output.summary` is routed to the `output.to`
   sink.

The capture in step 1 is the whole reason this works. By the time the skill actually runs, focus has
moved to its input boxes, cards, and dialogs — the "active editor" may be gone. So Skiller records *where you launched from* up front
and carries it through the run, rather than guessing at completion time.

## Reading context: `from:`

`from:` binds an input to a piece of editor state. The [full source list is in the
reference](../../reference/skill-yaml/#binding-inputs-to-editor-context) — `selection`, `activeFile`
and its `.path` / `.content` / `.language`, `git.staged`, `git.working`, `diagnostics`, and `tools` (the installed language-model tools, one per line; an ambient
source that never triggers a code action).

The binding is a *fallback*, not an override: a value passed in (for example by Copilot) or a
`default` always wins, and the context only fills an input that would otherwise be empty. So a
`from: selection` input is filled from the highlighted code when you launch from the editor, and
quietly falls back to its normal prompt when there's nothing selected. The same skill works either
way.

## Writing back: `output.to`

`output.to` names a sink for the finished summary. The [full sink list is in the
reference](../../reference/skill-yaml/#output-sinks-outputto); they fall into three groups:

- **New surfaces** — `newDocument`, `file:‹path›`: create something new. Lowest stakes.
- **Write-back** — `editor.replaceSelection`, `editor.insert`, `diff`: change the document you
  launched from.
- **Terminal** — `terminal` (types it, you press Enter) or `terminal.run` (types it and runs it):
  hand a command to your shell.

## Skiller stages; it doesn't act behind your back

The write-back and terminal sinks could clobber your work or run something you didn't read. They're
deliberately built so they can't:

- **The terminal sinks never run something you didn't approve.** `terminal` types the command onto
  your prompt and stops — you read it, edit it if you like, and press Enter yourself. `terminal.run`
  *does* run it, but it's only ever paired with a confirmation step that showed you the exact command
  first, so it executes what you reviewed — not a surprise. (The bundled `shell-it` skill drafts a
  command, shows it for confirmation, then runs it on confirm.)
- **Write-back sinks never clobber a changed document.** The result is written to the document and
  selection captured *at launch*. If that document changed in the meantime, the destructive write is
  refused and the result opens in a new tab instead — your edits are never silently overwritten.
- **`diff` is a review, not an apply.** It opens a diff against the launch document scoped to your
  selection; nothing changes until you choose **Apply** (and if the file moved on while the diff was
  open, the apply is refused).
- **`file:` stays in the workspace.** Like the built-in file tools, a `file:` path that resolves
  outside the workspace is refused unless you opt in with
  [`allowOutsideWorkspaceWrites`](../../reference/settings/#skillerskillsallowoutsideworkspacewrites).

:::note[Empty output is dropped]
A sink is never handed empty content — a blank result won't wipe your selection or truncate a file.
A wrapping ```` ```lang ```` code fence around the whole result is stripped first, so a fenced command
or snippet lands verbatim.
:::

## Where you launch from

Every entry point — a code action, the editor context menu, **Skiller: Run Skill…**, or Copilot's
`skiller_runSkill` tool — captures the editor first and runs the skill directly. See
[Running skills](../../guides/running-skills/).

## See also

- [skill.yaml reference](../../reference/skill-yaml/) — the exact `from:` sources and `output.to` sinks.
- [Build an editor-native skill](../../guides/build-an-editor-native-skill/) — a selection-to-selection skill, end to end.
- [Commands](../../reference/commands/#in-the-editor) — the launch surfaces.
- [Running skills](../../guides/running-skills/) — what a run looks like once it starts.
