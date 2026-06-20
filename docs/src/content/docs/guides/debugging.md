---
title: Debug a skill
description: Inspect prompts and responses, use verbose mode, and recover stuck runs.
sidebar:
  order: 3
---

When a skill misbehaves, the cause is almost always one of three things: a prompt that
didn't interpolate the way you expected, a model reply you can't see, or a run wedged at a
confirmation. Skiller gives you a tool for each. This guide walks through the fastest path
from "something is wrong" to a fix.

## Start by seeing the prompt and response

By default Skiller shows only step output and confirmations — the prompts and raw model
replies stay hidden. Turn that on with `skiller.skills.verboseMode`:

| Value | What you see |
| ----- | ------------ |
| `"off"` (default) | Nothing extra — only step output and confirmation buttons. |
| `"rendered"` | The fully interpolated prompt as a code block, plus the response as rendered Markdown. |
| `"raw"` | The prompt and response as plain text, exactly as exchanged with the model. |

1. Open Settings (search for "Skiller") and set **`skiller.skills.verboseMode`** to
   `"rendered"`.
2. Re-run the skill from `@skiller` chat.
3. Read the printed prompt. Confirm that every `{{ inputs.* }}` and `{{ outputs.* }}`
   resolved to the value you expected — an empty or wrong substitution here is your bug.

Use `"rendered"` for most work; switch to `"raw"` when rendered Markdown is hiding
whitespace, escaping, or formatting you need to see exactly. See
[Settings](../../reference/settings/#skillerskillsverbosemode) for the full description.

## Inspect a single step from the graph

Verbose mode prints everything inline; the [live execution graph](../../concepts/execution-graph/)
lets you zoom in on one step after it has run, without re-reading the whole transcript.

1. Open the graph from the **"Show Graph"** CodeLens above the `skill.yaml`.
2. Run the skill.
3. **Hover an executed node.** A popover shows a meta line (model, duration, tools used,
   status), the **fully interpolated prompt** the step received, and — for `llm` steps —
   the model's **response**.
4. Click **Open ↗** to read the captured prompt and response in a read-only document, or
   **Copy** to put the prompt on your clipboard and paste it elsewhere.

Hover inspection is available for `llm` and `confirmation` steps. `tool` steps and skipped
steps capture no prompt, so hovering them shows a short "nothing captured" note. The captured
data is session-scoped — it lasts as long as the run's state and is cleared on reset. Because
the read-only doc refreshes in place when a step re-runs, a loop always shows its latest
iteration, which makes it the best way to see how each pass through a `goto` differs.

## Catch manifest mistakes at edit time

You don't have to run a skill to find a broken manifest. The graph panel re-renders as you
edit `skill.yaml`, and if an edit makes the file invalid it surfaces the problem inline:

- **Parse errors** and **schema-validation errors** appear as a banner over the graph.
- **Warnings** appear in a collapsible panel.

Keep the panel open beside the editor while you author. Because Skiller's schema is strict,
an unknown or misspelled key is rejected with a did-you-mean suggestion the moment you save —
catch `tool_mode` typed as `toolMode`, or `goto_step` as `gotoStep`, here rather than at run
time.

After editing a manifest on disk, run `@skiller /reload` so the skill registry and any other
open panels pick up the change; it prints an added / removed / parse-error diff of what it
found.

## The empty-interpolation trap

The most common silent failure is the **JSON-fallback trap**. An `llm` reply that is valid
JSON is parsed into an object you can read field by field (`{{ outputs.draft.text }}`). But
if the reply is *not* valid JSON — a stray trailing comma, prose wrapped around the object, an
unclosed code fence — it is stored as a raw string instead, with no error.

:::caution[Symptom: a value renders empty, not an error]
When the reply has fallen back to a string, `{{ outputs.draft.text }}` resolves to a missing
property on that string and renders **empty**. There is no exception — just a blank where your
data should be. If a downstream value is mysteriously missing, suspect this first.
:::

To confirm and fix it:

1. Set `skiller.skills.verboseMode` to `"raw"` and re-run.
2. Read the exact reply the step received. If it is text instead of clean JSON, the parse
   failed.
3. Tighten the prompt so the model returns only JSON (for example, "Respond with JSON only,
   no prose, no code fences"), then re-run and confirm the field resolves.

See [Step types](../../concepts/step-types/#json-auto-parse) for how the auto-parse and fallback
work.

## Recover a stuck run

If a skill is paused at a confirmation, or its state feels wedged, three **control commands**
get you unstuck. They are dispatched *before* the pending-interaction gate, so they run even
while a skill is waiting for input — the pending state can never block its own escape hatch.

| Command | Use it when |
| ------- | ----------- |
| `/status` | You're not sure whether anything is paused — it reports whether a skill is awaiting input and at which step. |
| `/cancel` | A single skill is stuck at a confirmation and you want to abort just that run. |
| `/reset` | State is thoroughly stuck — it clears all Skiller state, pending interactions and graph highlights alike. |

Pending state is isolated per conversation, so run `/cancel` or `/reset` from the same chat
that started the skill. See [Commands](../../reference/commands/#control-commands-work-mid-skill)
for the full behavior.

## A debugging checklist

- **Value is wrong or empty?** → `verboseMode: "rendered"`, read the prompt, confirm the
  interpolation.
- **`{{ outputs.x.field }}` is blank?** → JSON-fallback trap; `verboseMode: "raw"` and check
  the reply is real JSON.
- **Need the exact prompt one step saw?** → hover that node in the live execution graph.
- **Manifest won't load?** → read the inline parse/validation banner, then `/reload`.
- **Run is wedged?** → `/status`, then `/cancel` or `/reset`.

## Related

- **Concept:** [The execution graph](../../concepts/execution-graph/) — hover inspection and
  live validation in full.
- **Concept:** [Step types](../../concepts/step-types/) — the state model and the JSON-fallback
  behavior behind the empty-interpolation trap.
- **Reference:** [Settings](../../reference/settings/) — `verboseMode` and the other
  `skiller.*` settings.
- **Reference:** [Commands](../../reference/commands/) — `/status`, `/cancel`, and `/reset`.
