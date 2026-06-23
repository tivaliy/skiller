---
title: Editor-native skills
description: How skills read your editor and write back to it — context inputs, output sinks, launch surfaces, and the safety model behind them.
sidebar:
  order: 5
---

A skill doesn't have to live entirely in chat. It can **read** your editor — the selection, the
current file, a git diff, the problems list — to fill its inputs, and it can **write its result
back** — to a new document, a file, your selection, a diff, or the terminal. That's an
*editor-native* skill: you launch it from where you're working, and the result lands where you
expect it.

Two manifest fields turn an ordinary skill into an editor-native one:

- [`inputs[].from`](../../reference/skill-yaml/#binding-inputs-to-editor-context) — fill an input from editor context instead of prompting.
- [`output.to`](../../reference/skill-yaml/#output-sinks-outputto) — deliver the finished result to a destination instead of (just) chat.

Neither is required, and they're independent: a skill can read context without an output sink, route
output without binding context, or do both.

## The shape of a run

When you launch a skill from the editor, four things happen in order:

1. **Capture** — Skiller snapshots the editor state *at that moment*: the selection, file, diffs, and
   diagnostics the skill declares it needs (and only those).
2. **Launch** — chat opens and the skill starts (see [the run surface](#the-run-surface) below).
3. **Run** — `from:` inputs are filled from the snapshot; anything not bound, or empty, is collected
   the normal way (prompt / argument / default).
4. **Deliver** — when the skill finishes, its rendered `output.summary` is routed to the `output.to`
   sink.

The capture in step 1 is the whole reason this works. By the time the skill actually runs, focus has
moved into chat — the "active editor" is gone. So Skiller records *where you launched from* up front
and carries it through the run, rather than guessing at completion time.

## Reading context: `from:`

`from:` binds an input to a piece of editor state. The [full source list is in the
reference](../../reference/skill-yaml/#binding-inputs-to-editor-context) — `selection`, `activeFile`
and its `.path` / `.content` / `.language`, `git.staged`, `git.working`, and `diagnostics`.

The binding is a *fallback*, not an override: an explicit launch argument or a `default` always wins,
and the context only fills an input that would otherwise be empty. So a `from: selection` input is
filled from the highlighted code when you launch from the editor, and quietly falls back to its normal
prompt when there's nothing selected (or when you run the skill from chat, where there's no editor
context at all). The same skill works in both places.

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

## The run surface

Launching from the editor (a code action, the editor context menu, or `Skiller: Run Skill` in the
Command Palette) opens chat to run the skill. The
[`skiller.skills.runSurface`](../../reference/settings/#skillerskillsrunsurface) setting decides what
happens at that hand-off:

- `adaptive` (default) — chat opens with the command **prefilled**; you get a beat to review or add
  arguments, then submit.
- `chat` — the run **starts immediately**.

It's a control-vs-speed choice, and it only affects editor launches — running a skill from chat means
you've already typed the command yourself.

## See also

- [skill.yaml reference](../../reference/skill-yaml/) — the exact `from:` sources and `output.to` sinks.
- [Build an editor-native skill](../../guides/build-an-editor-native-skill/) — a selection-to-selection skill, end to end.
- [Commands](../../reference/commands/#launching-from-the-editor) — the launch surfaces.
- [Settings](../../reference/settings/#skillerskillsrunsurface) — the run surface.
