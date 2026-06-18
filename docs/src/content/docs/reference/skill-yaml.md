---
title: skill.yaml reference
description: Every field of the skill manifest — top-level keys, inputs, steps, and confirmation options.
sidebar:
  order: 1
---

The `skill.yaml` manifest is validated against a strict schema: **unknown keys are rejected** (which
catches typos), `name` and at least one step are **required**, and step `id`s and `output` names
must be unique.

## Annotated manifest

```yaml
name: Commit Message              # required — human-readable name
description: Draft a commit message   # recommended (default: "")
version: "1.0.0"                  # semver (default: "1.0.0")
id: commit-message                # optional — defaults to the folder name
author: you                       # optional

inputs:                           # optional — collected before the skill runs
  - name: summary
    type: string                  # string | number | boolean | array (default: string)
    required: true                # default: true
    prompt: "What changed?"       # shown when collected interactively

models:                           # optional — omit to use the model selected in chat
  default: gpt-4o                 # used when chat is in "Auto" mode
  aliases:
    fast: gpt-4o-mini

tools:                            # optional — map friendly names to MCP tool names
  aliases:
    create_file: skiller_createFile

steps:                            # required — at least one
  - id: draft                     # required, unique
    type: llm                     # llm | confirmation | tool (required)
    file: steps/01-draft.md
    output: draft                 # store the reply as outputs.draft

on_error: abort                   # abort (default) | continue

output:
  summary: "✅ Done."             # message shown when the skill finishes
```

## Top-level keys

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | **yes** | Human-readable name |
| `steps` | list | **yes** | At least one step |
| `description` | string | no | Default `""` |
| `version` | string | no | Semver, default `1.0.0` |
| `id` | string | no | Defaults to the folder name |
| `author` | string | no | — |
| `inputs` | list | no | See [Inputs](#inputs) |
| `models` | map | no | `default` + `aliases` |
| `tools` | map | no | `aliases` (append `?` to a tool name to make it optional) |
| `on_error` | enum | no | `abort` (default) or `continue` |
| `output` | map | no | `summary` only |

## Inputs

| Field | Type | Notes |
| ----- | ---- | ----- |
| `name` | string | **Required.** Read in templates as `{{ inputs.<name> }}` |
| `type` | enum | `string` (default), `number`, `boolean`, `array` |
| `description` | string | Default `""` |
| `required` | boolean | Default `true` |
| `default` | any | Used when not provided |
| `prompt` | string | Shown when collected interactively |
| `enum` | list | Restrict to these values |
| `pattern` | string | Regex (string inputs) |

Pass inputs when launching: `@skiller /skill <id> name=value "positional value"` — named values
match by name; positional values fill the remaining inputs in declaration order.

## Steps

Common to all steps: `id` (required, unique), `type` (required), `description`, `output`, `when` (a
Liquid condition), and `requires` (step IDs that must run first).

| Type | Key fields |
| ---- | ---------- |
| `llm` | `file` **or** `message`; `model`; `tools`; `tool_mode` (`auto` / `required`); `output` |
| `confirmation` | `message` **or** `file`; `options`; `output` (choice at `outputs.<name>.selectedOption`) |
| `tool` | `tool` (alias, required); `params` |

### Confirmation options

Each entry in a confirmation step's `options`:

| Field | Notes |
| ----- | ----- |
| `label` | **Required.** Button text |
| `action` | `continue`, `abort`, or `goto` |
| `goto_step` | Target step `id` — required when `action: goto` |

See [Write your first skill](../../getting-started/write-your-first-skill/) for a complete, working
example.
