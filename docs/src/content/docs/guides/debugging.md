---
title: Debug a skill
description: Inspect prompts and responses, catch manifest mistakes, and recover stuck runs.
sidebar:
  order: 5
---

When a skill misbehaves, the cause is almost always one of three things: a prompt that
didn't interpolate the way you expected, a model reply you can't see, or a run wedged at a
confirmation. Skiller gives you a tool for each. This guide walks through the fastest path
from "something is wrong" to a fix.

## Start by seeing the prompt and response

A run shows you its confirmations and its result, but not the prompts it sent or the raw
replies it got back. The [live execution graph](../../concepts/execution-graph/) captures both
for every step, so you can read exactly what one step saw and produced after it has run.

1. Open the graph from the **"Show Graph"** CodeLens above the `skill.yaml`.
2. Run the skill.
3. **Hover an executed node.** A popover shows a meta line (model, duration, tools used,
   status), the **fully interpolated prompt** the step received, and — for `llm` steps —
   the model's **response**.
4. Click **Open ↗** to read the captured prompt and response in a read-only document, or
   **Copy** to put the prompt on your clipboard and paste it elsewhere.
5. Confirm that every `{{ inputs.* }}` and `{{ outputs.* }}` in the prompt resolved to the
   value you expected — an empty or wrong substitution here is your bug.

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

After editing a manifest on disk, run **Skiller: Reload Skills** so the skill registry and any
other open panels pick up the change; it reports how many skills were added and removed, and any
parse errors.

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

1. Hover the step in the graph and click **Open ↗**.
2. Read the exact reply the model returned. If it is text instead of clean JSON, the parse
   failed.
3. Tighten the prompt so the model returns only JSON (for example, "Respond with JSON only,
   no prose, no code fences"), then re-run and confirm the field resolves.

See [Step types](../../concepts/step-types/#json-auto-parse) for how the auto-parse and fallback
work.

## Recover a stuck run

A running skill shows a progress notification with its current step — or *Waiting for you*
when a card is open in the graph. To stop it, click **Cancel** on that notification or run
**Skiller: Cancel Run**. Cancelling clears any open card and ends the run; starting another
skill while one is running asks whether to cancel the first.

If a tool you once marked **Always allow in this workspace** should ask again, run
**Skiller: Reset Tool Approvals**. See [Running skills](../running-skills/).

## A debugging checklist

- **What happened, in order?** → the [run log](../running-skills/#the-run-log) in the **Skiller**
  output channel: inputs, each step's model, duration and output, tool calls, and your answers.
- **Value is wrong or empty?** → hover the step in the graph, read the prompt, confirm the
  interpolation.
- **`{{ outputs.x.field }}` is blank?** → JSON-fallback trap; **Open ↗** the step and check
  the reply is real JSON.
- **Manifest won't load?** → read the inline parse/validation banner, then **Reload Skills**.
- **Run is wedged?** → **Cancel** on the progress notification, or **Skiller: Cancel Run**.

## Related

- **Concept:** [The execution graph](../../concepts/execution-graph/) — hover inspection and
  live validation in full.
- **Concept:** [Step types](../../concepts/step-types/) — the state model and the JSON-fallback
  behavior behind the empty-interpolation trap.
- **Reference:** [Settings](../../reference/settings/) — every `skiller.*` setting.
- **Reference:** [Commands](../../reference/commands/) — **Cancel Run**, **Reload Skills**, and
  **Reset Tool Approvals**.
