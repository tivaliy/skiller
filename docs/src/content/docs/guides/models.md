---
title: Use & override models
description: Set default and per-step models, and understand Auto vs user-override.
sidebar:
  order: 4
---

A skill can pin the language model each step uses, fall back to a friendly alias, or leave
the choice entirely to the chat picker. This guide shows the three layers — `models.default`,
per-step `model`, and the chat-dropdown override — and how Skiller resolves them.

## 1. Set a default model

`models.default` is the model every step uses unless it says otherwise. The `greeter` example
skill pins it to `gpt-4o`:

```yaml
models:
  default: gpt-4o
```

Omit `models` entirely and every step uses whatever model is selected in the chat model picker.
A `models.default` is most useful when a skill needs a specific model's behavior to be
reproducible regardless of who runs it.

## 2. Override the model for one step

Any `llm` step can set its own `model`, which overrides `models.default` for that step only.
In `greeter`, the closing `fact` step asks for a different model than the rest of the skill:

```yaml
models:
  default: gpt-4o

steps:
  - id: greet
    type: llm
    file: steps/01-greet.md
    output: greeting

  - id: fact
    type: llm
    file: steps/02-fact.md
    model: gpt-4.1        # per-step model override
    output: fun_fact
```

The `greet` step runs on `gpt-4o` (the default); the `fact` step runs on `gpt-4.1`. Use a
per-step `model` to send the cheap, mechanical steps to a fast model and reserve a stronger
model for the steps that need it.

## 3. Name models with aliases

`models.aliases` maps a friendly name to a model ID. A step's `model` can then reference the
alias instead of the raw ID, so you change the model in one place:

```yaml
models:
  default: smart
  aliases:
    fast: gpt-4o-mini
    smart: gpt-4o

steps:
  - id: draft
    type: llm
    file: steps/draft.md
    model: fast        # resolves to gpt-4o-mini
    output: draft
```

`models.default` and a step's `model` both accept either an alias or a direct model ID.

## Auto vs user-override

The model the chat session is set to matters as much as the manifest:

- **Auto** — the chat model picker left on its default (not a literal menu item). Each step uses
  the model it resolved from the manifest (per-step `model` → `models.default` → the session model).
- **User-override** — when you pick a specific model in the chat model dropdown, that choice
  **overrides all skill configuration**: `models.default` and every per-step `model` are
  ignored for the run, and Skiller shows a banner so the override is never silent.

:::tip[Why the override exists]
The dropdown override lets you try a skill against a different model without editing its
manifest — handy when you are deciding what to pin, or when the model a skill names is not
available in your setup.
:::

## Fallback and date-suffixed IDs

When a step asks for a model that the chat LM provider does not expose under that exact ID,
Skiller does not fail outright:

- It matches **date-suffixed IDs** — a configured `gpt-4o` resolves a provider model published
  as `gpt-4o-2024-08-06`, so manifests stay readable as providers append dated revisions.
- If no match is found, Skiller falls back to the session's selected model and warns you, rather
  than aborting the run.

Run `@skiller /models` to list the exact model IDs your provider currently exposes — those are
the values to put in `models.default` and `models.aliases`.

## Related

- **Reference:** [`skill.yaml` manifest](../../reference/skill-yaml/#models) — the `models`
  schema and per-step `model` field.
- **Reference:** [Commands](../../reference/commands/) — `/models` lists the available model IDs.
- **Concept:** [Step types](../../concepts/step-types/) — where the per-step `model` lives and how
  each `llm` step is resolved.
