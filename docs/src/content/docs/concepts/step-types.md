---
title: Step types
description: The three step types — llm, confirmation, and tool — and how state flows between them.
sidebar:
  order: 2
---

A skill's `steps` run in order. Every step has a unique `id`, a `type`, and an optional
`output` name that later steps read back. There are exactly three types: `llm`,
`confirmation`, and `tool`.

## `llm` — call the model

Renders a [Liquid](https://liquidjs.com/) prompt and sends it to the model. The reply is
stored under the step's `output` name.

```yaml
steps:
  - id: greet
    type: llm
    file: steps/01-greet.md
    output: greeting
```

| Field | Description |
| ----- | ----------- |
| `file` | Path to a Markdown prompt file, relative to the skill directory |
| `message` | Inline prompt — use instead of `file` (provide exactly one) |
| `model` | Model alias or ID for this step (optional override) |
| `tools` | Tool aliases the model may call (agentic tool use) |
| `tool_mode` | `auto` (the model decides whether to call a tool) or `required` (it must call one — needs a non-empty `tools`) |
| `output` | Name to store the reply under — read it as `outputs.<name>` |

An `llm` step needs either `file` or `message`, not both. When the step declares `tools`,
the model runs an agentic loop: it may call those tools, read the results, and keep going
until it produces a final reply. Use `tool_mode: auto` to let the model choose, or
`tool_mode: required` to force at least one tool call.

## `confirmation` — pause for a human

Shows a message with buttons and waits for your click. This is Skiller's human-in-the-loop
core.

```yaml
steps:
  - id: confirm
    type: confirmation
    message: |
      {{ outputs.greeting }}

      Would you like me to also generate a fun fact?
    options:
      - { label: "Yes, give me a fun fact",       action: continue }
      - { label: "No thanks, just the greeting",  action: abort }
    output: user_choice
```

| Field | Description |
| ----- | ----------- |
| `message` / `file` | The text to show (Liquid-templated) |
| `options` | The buttons — each has a `label` and an `action` |
| `output` | Stores the choice as an object (see below) |

Each option's `action` is one of:

- `continue` — proceed to the next step
- `abort` — stop the skill
- `goto` — jump to another step (set `goto_step: <step id>`); this is how you branch and loop

The `output` is an object, not a string:

```text
{ selectedOption, selectedIndex, action, timestamp }
```

Read the chosen label as `{{ outputs.user_choice.selectedOption }}`. If you omit `options`,
the step defaults to a Continue / Cancel pair.

## `tool` — invoke one tool directly

Calls a single tool (no model), with templated parameters. The `tool` value is usually an alias
defined under the manifest's `tools.aliases` — a raw tool name also works, but aliasing is recommended.

```yaml
tools:
  aliases:
    create_file: skiller_createFile     # alias -> built-in LM tool
steps:
  - id: save
    type: tool
    tool: create_file
    params:
      filePath: "notes.md"
      content: "{{ outputs.draft.text }}"
    output: saved
```

| Field | Description |
| ----- | ----------- |
| `tool` | The tool to invoke — an alias from `tools.aliases`, or a raw tool name (required) |
| `params` | Parameters passed to the tool (recursively Liquid-templated) |

A `tool` step must **not** carry `tools` or `tool_mode` — those belong to agentic `llm`
steps. The example above uses the [built-in `skiller_createFile`
tool](../../reference/built-in-tools/), so it runs with no MCP setup; aliases can equally
point at any MCP tool you have configured.

## How state flows between steps

Steps **don't share conversation history** — each `llm` call starts fresh, with no memory
of earlier turns. The only channel between steps is `outputs`: a step with `output: draft`
stores its result, and later steps (and their prompts) read it as `{{ outputs.draft }}`.

To carry information forward — a running summary, a loop's accumulated notes — you must
write it into an `output` and read it back in the next prompt. There is no implicit context.

## JSON auto-parse

When an `llm` reply is valid JSON, Skiller parses it into an object, so you can read
individual fields:

```yaml
- id: draft
  type: llm
  file: steps/01-draft.md   # replies with { "text": "..." }
  output: draft
- id: review
  type: confirmation
  message: "{{ outputs.draft.text }}"   # ← reads the parsed field
```

If the reply is **not** valid JSON, it is stored as the raw string instead.

:::caution[The JSON-fallback trap]
Auto-parse fails silently. If you expect JSON but the model returns malformed JSON (a stray
trailing comma, prose wrapped around the object, a code fence it forgot to close), the reply
falls back to a raw string. Then `{{ outputs.draft.text }}` resolves to a missing property
on a string and renders **empty** — no error, just a blank where your data should be. If a
downstream value is mysteriously empty, that is the first thing to check. Turn on
`skiller.skills.verboseMode` to see the exact reply Skiller received (see
[Debug a skill](../../guides/debugging/)).
:::

## Watching steps run

As a skill runs, Skiller draws it as a **live execution graph** in a side panel. Each step
lights up through its states — pending, active, awaiting input, completed, error — and
`goto` branches and loops animate as they fire. See
[The execution graph](../execution-graph/) for the full surface.

## Next

- **Reference:** [`skill.yaml` manifest](../../reference/skill-yaml/) — every field of every
  step type.
- **Concept:** [Templating with Liquid](../templating/) — how `{{ outputs.* }}` and the rest
  of the prompt context resolve.
- **Concept:** [The execution graph](../execution-graph/) — the live visualization of these
  steps.
