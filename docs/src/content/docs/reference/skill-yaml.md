---
title: skill.yaml reference
description: Every field of the skill manifest — top-level keys, inputs, models, tools, steps, and confirmation options.
sidebar:
  order: 1
---

The `skill.yaml` manifest is validated against a strict schema. **Unknown keys are rejected** (with
did-you-mean suggestions, so typos surface immediately), `name` and **at least one step** are
required, and step `id`s and `output` names must be unique. Keys are `snake_case` — `on_error`,
`tool_mode`, `goto_step`.

This page documents every field. For the YAML that goes at the top of a step's prompt file, see
[Step-file frontmatter](../step-frontmatter/). For the `{{ ... }}` syntax used in values, see
[Templating with Liquid](../../concepts/templating/).

## Top-level keys

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | **yes** | Human-readable name |
| `steps` | list | **yes** | At least one step; see [Steps](#steps) |
| `description` | string | no | Default `""` |
| `version` | string | no | Semver (`x.y.z`), default `1.0.0` |
| `id` | string | no | Defaults to the folder name |
| `author` | string | no | — |
| `inputs` | list | no | See [Inputs](#inputs) |
| `models` | map | no | `default` + `aliases`; see [Models](#models) |
| `tools` | map | no | `aliases`; see [Tools](#tools) |
| `on_error` | enum | no | `abort` (default) or `continue` |
| `output` | map | no | `summary` only |

The `greeter` example skill uses most of them:

```yaml
# .skiller/skills/greeter/skill.yaml
id: greeter
name: Greeter
description: A simple greeting workflow demonstrating multi-step skills with confirmation
version: "1.1.0"

inputs:
  - name: name
    type: string
    description: Your name
    required: true
    prompt: "What is your name?"

models:
  default: gpt-4o

steps:
  - id: greet
    type: llm
    file: steps/01-greet.md
    output: greeting

  - id: confirm
    type: confirmation
    message: |
      {{ outputs.greeting }}

      Would you like me to also generate a fun fact?
    options:
      - { label: "Yes, give me a fun fact",       action: continue }
      - { label: "No thanks, just the greeting",  action: abort }
    output: user_choice

  - id: fact
    type: llm
    file: steps/02-fact.md
    model: gpt-4.1        # per-step model override
    output: fun_fact

on_error: abort

output:
  summary: "{{ outputs.fun_fact }}"
```

## Inputs

`inputs[]` declares the values collected from the user before the skill runs. Each input is read in
templates as `{{ inputs.<name> }}`.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `name` | string | **Required.** Unique within the skill |
| `type` | enum | `string` (default), `number`, `boolean`, `array` |
| `description` | string | Default `""` |
| `required` | boolean | Default `true` |
| `default` | any | Used when the value is not provided |
| `prompt` | string | Shown when the value is collected interactively |
| `enum` | list of strings | Restrict to these values (≥1 entry) |
| `pattern` | string | Regex the value must match (string inputs) |

```yaml
inputs:
  - name: category
    type: string
    required: false
    default: "anything"
    prompt: "What kind of thing is it?"
    enum:                      # offer a fixed set of choices
      - "anything"
      - "an animal"
      - "a place"

  - name: ticket
    type: string
    required: true
    prompt: "Ticket key?"
    pattern: "^[A-Z]+-[0-9]+$" # e.g. PROJ-123
```

Pass inputs when launching: `@skiller /skill <id> ticket=PROJ-12 "positional value"` — named values
match by name; positional values fill the remaining inputs in declaration order.

## Models

`models` is optional. Omit it to use the model selected in the chat picker.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `default` | string | Model used by steps that don't set their own `model` |
| `aliases` | map | Friendly name → model ID, usable as a step's `model` |

```yaml
models:
  default: gpt-4o
  aliases:
    fast: gpt-4o-mini
    smart: gpt-4o
```

A step then refers to an alias or a direct ID via its `model` field (see [llm steps](#llm-steps)).
A model picked in the chat model dropdown overrides all of this and shows a banner — see
[Use & override models](../../guides/models/).

## Tools

`tools.aliases` maps a friendly name to an underlying tool name — a [built-in tool](../built-in-tools/)
or a configured MCP tool. Steps usually reference the **alias** (a `tool` step also accepts a raw tool name, but aliasing is recommended). Append `?` to mark a
tool optional: if it isn't available at run time, steps that use it are skipped instead of failing.

```yaml
tools:
  aliases:
    create_file: skiller_createFile   # alias -> built-in LM tool
    search: my_mcp_searchTool         # alias -> a configured MCP tool
    notify: my_mcp_notify?            # optional: skipped if unavailable
```

## Steps

`steps[]` is the ordered list of work. Every step shares a set of common fields; each `type` then adds
its own.

**Common fields (all step types):**

| Field | Required | Notes |
| ----- | -------- | ----- |
| `id` | **yes** | Unique. Starts with a letter; letters, numbers, `_`, `-` |
| `type` | **yes** | `llm`, `confirmation`, or `tool` — no default |
| `description` | no | Shown in the live execution graph |
| `output` | no | Unique name; stores the step result as `outputs.<name>` |
| `when` | no | Liquid condition; the step is skipped when it evaluates falsy |
| `requires` | no | List of step `id`s that must run before this one |

`when` is evaluated **permissively** — an undefined variable is treated as falsy rather than throwing,
so it is safe to guard a step against state that may not exist yet:

```yaml
- id: summarize
  type: llm
  file: steps/summarize.md
  when: "outputs.findings"        # bare expression — runs only once findings exist
  requires: [research]            # research must run first
  output: summary
```

Write `when` as a **bare Liquid expression** (e.g. `outputs.findings`, `inputs.count > 0`) — Skiller
evaluates its truthiness for you. Don't wrap it in `{% if %}` or `{{ }}`; a wrapped value never
evaluates correctly and the step is always skipped.

### llm steps

Send a prompt to the model. Provide the prompt with **exactly one** of `file` or `message`.

| Field | Notes |
| ----- | ----- |
| `file` | Path to a Markdown prompt file, relative to the skill folder |
| `message` | Inline prompt (alternative to `file`) |
| `model` | Alias or direct model ID; overrides `models.default` for this step |
| `tools` | List of tool **aliases** the model may call (agentic use) |
| `tool_mode` | `auto` (model decides) or `required` (must call a tool; needs non-empty `tools`) |

```yaml
tools:
  aliases:
    search: my_mcp_searchTool      # a real MCP tool you configured in VS Code
steps:
  - id: research
    type: llm
    file: steps/01-research.md
    tools: [search]
    tool_mode: auto      # "auto" (model decides) | "required" (must call a tool; needs non-empty tools)
    output: findings
```

When an `llm` reply is **valid JSON it is auto-parsed**, so you can read fields with
`{{ outputs.findings.title }}`. Otherwise the reply is stored as a raw string.

:::caution[JSON-fallback trap]
If a step is meant to return JSON but the model emits something malformed, the reply silently falls
back to a raw string — it does not error. `{{ outputs.x.field }}` then renders **empty** instead of
failing. See [Step types & state](../../concepts/step-types/) for how to catch this.
:::

### confirmation steps

Pause and show the user a choice. Provide the message with `message` or `file`.

| Field | Notes |
| ----- | ----- |
| `message` | Inline prompt text (Liquid-interpolated) |
| `file` | Path to a Markdown message file (alternative to `message`) |
| `options` | List of choices; defaults to **Continue** / **Cancel** if omitted |

Each entry in `options`:

| Field | Required | Notes |
| ----- | -------- | ----- |
| `label` | **yes** | Button text |
| `action` | **yes** | `continue`, `abort`, or `goto` |
| `goto_step` | when `action: goto` | Target step `id` to jump to |

A `goto` can point **backward** (loop) or **forward** (branch):

```yaml
- id: answer
  type: confirmation
  message: "{{ outputs.turn.question }}"
  options:
    - { label: "Yes",                    action: goto, goto_step: ask }   # loop back
    - { label: "No",                     action: goto, goto_step: ask }
    - { label: "I'm ready — guess now!", action: goto, goto_step: guess } # branch forward
  output: reply
```

The step's `output` is an object:

| Field | Type | Notes |
| ----- | ---- | ----- |
| `selectedOption` | string | The chosen option's `label` |
| `selectedIndex` | number | 1-based index as shown to the user |
| `action` | string | `continue`, `abort`, or `goto` |
| `timestamp` | number | When the user confirmed |

Read it as `{{ outputs.reply.selectedOption }}`. See
[Branch & loop with confirmations](../../guides/branching-looping/) for the full pattern.

### tool steps

Invoke a single tool. Takes a `tool` (an alias from `tools.aliases`, or a raw tool name) and optional `params`. A `tool`
step must **not** carry `tools` or `tool_mode` — those apply only to `llm` steps.

| Field | Required | Notes |
| ----- | -------- | ----- |
| `tool` | **yes** | A tool **alias** from `tools.aliases`, or a raw tool name |
| `params` | no | Map passed to the tool; values are recursively Liquid-interpolated |

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

## on_error

Top-level. Controls what happens when a step fails.

| Value | Behavior |
| ----- | -------- |
| `abort` | Stop the skill on the first error (default) |
| `continue` | Skip the failed step and keep going |

## output

Top-level. `output.summary` is a Liquid template rendered after the skill finishes — the closing
message shown to the user.

```yaml
output:
  summary: "✅ Saved to {{ outputs.saved.filePath }}."
```

:::note[Strict schema]
Every level rejects unknown keys with a did-you-mean suggestion. Keys are `snake_case`
(`on_error`, `tool_mode`, `goto_step`). When `@skiller /reload` reports a parse error, it is usually a
misspelled or misplaced key.
:::

## See also

- [Step-file frontmatter](../step-frontmatter/) — the YAML at the top of a step's prompt file.
- [Templating with Liquid](../../concepts/templating/) — the `{{ ... }}` and `{% ... %}` syntax.
- [Step types & state](../../concepts/step-types/) — how `llm`, `confirmation`, and `tool` steps run.
