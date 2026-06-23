---
title: Build an editor-native skill
description: Build a skill that reads your selection, rewrites it with the model, and shows the result as a reviewable diff — launched from the editor.
sidebar:
  order: 5
---

This guide builds a skill that takes the **selected code**, rewrites it from a short instruction, and
shows the result as a **diff** you can review and apply — all launched from the editor, no typing in
chat. It uses the two editor-native fields, [`from:`](../../reference/skill-yaml/#binding-inputs-to-editor-context)
and [`output.to`](../../reference/skill-yaml/#output-sinks-outputto); for the model behind them, see
[Editor-native skills](../../concepts/editor-native-skills/).

## What we're building

A `rewrite-selection` skill that:

- reads the **selection** and the file's **language** from the editor,
- asks you (once) *how* to rewrite it,
- sends it to the model, and
- opens the rewrite as a **diff** against your selection — nothing changes until you click **Apply**.

## 1. The manifest

Create `.skiller/skills/rewrite-selection/skill.yaml`:

```yaml
id: rewrite-selection
name: Rewrite Selection
description: Rewrite the selected code from an instruction and show it as a reviewable diff.
version: "1.0.0"

inputs:
  # Filled from the editor at launch. No prompt — if nothing is selected, the
  # input is empty and the skill falls back to asking, so it still works from chat.
  - name: code
    type: string
    from: selection
    description: The selected code

  - name: language
    type: string
    from: activeFile.language
    description: The file's language id

  # A normal prompted input — context never fills this, so you're always asked.
  - name: instruction
    type: string
    required: true
    prompt: "How should I rewrite the selection? (e.g. \"add doc comments\", \"simplify\")"

steps:
  - id: rewrite
    type: llm
    description: Rewrite the selection
    file: steps/01-rewrite.md
    output: rewritten

# Deliver the rewrite as a diff scoped to the launch selection — review, then Apply.
output:
  summary: "{{ outputs.rewritten }}"
  to: diff
```

The `code` and `language` inputs carry `from:`; `instruction` doesn't, so it's always prompted. That
mix is the point — bind what the editor can supply, ask for the rest.

## 2. The prompt

Create `.skiller/skills/rewrite-selection/steps/01-rewrite.md`. It's hardened to emit only the rewritten
code (no prose, no fences) so it diffs cleanly:

```markdown
You are a precise code editor. Rewrite the snippet below according to the instruction.

Language: {{ inputs.language }}
Instruction: {{ inputs.instruction }}

Snippet:
{{ inputs.code }}

Output rules:
- Output ONLY the rewritten snippet. No explanation, no markdown, no code fences.
- Preserve surrounding indentation so it drops back into place.
- Change only what the instruction asks for.
```

Run `@skiller /reload` so the registry picks up the new skill.

## 3. Launch it from the editor

1. Open any source file and **select** the code you want to rewrite.
2. Launch the skill — either:
   - right-click → **Run Skill** → `Rewrite Selection`, or
   - open the Command Palette → **Skiller: Run Skill** → `Rewrite Selection`.
3. Chat opens with the run ready (prefilled by default — see
   [`runSurface`](../../reference/settings/#skillerskillsrunsurface)). Skiller already captured your
   selection and the file's language, so it only asks the one thing it can't read: your **instruction**.
4. Answer the prompt. The skill runs and opens a **diff** of your selection vs. the rewrite.
5. Review it. Click **Apply** to accept, or just close it to discard.

Because the result goes to the `diff` sink, nothing touches your file until you Apply — and if you
edited the file while the diff was open, Skiller refuses the stale apply rather than garbling it.

## 4. Variations

- **Apply directly instead of reviewing.** Swap `to: diff` for `to: editor.replaceSelection` to write
  the rewrite straight back over the selection. It still won't clobber: if the document changed since
  launch, the result opens in a new tab instead.
- **Send a command to the terminal.** `to: terminal` types a drafted command onto your prompt and
  waits for you to press Enter; `to: terminal.run` types **and runs** it. Pair `terminal.run` with a
  confirmation step so the command is reviewed before it executes — the bundled `shell-it` skill does
  exactly this: drafts a command, confirms it in chat, then runs it.
- **Save to a file.** `to: "file:notes/{{ inputs.name }}.md"` writes a (templated) workspace file.
- **It still works from chat.** Run `@skiller /skill rewrite-selection` with no selection and the
  `from:` inputs fall back to prompting — the same skill, no editor required.

## See also

- [Editor-native skills](../../concepts/editor-native-skills/) — the capture-run-deliver model and the safety guarantees.
- [skill.yaml reference](../../reference/skill-yaml/) — every `from:` source and `output.to` sink.
- [Commands](../../reference/commands/#launching-from-the-editor) — the editor launch surfaces.
