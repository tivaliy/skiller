---
title: Use & override models
description: Set default and per-step models, and choose the fallback model for everything else.
sidebar:
  order: 6
---

A skill can pin the language model each step uses, name models through friendly aliases, or
leave the choice to you. This guide shows the layers — per-step `model`, `models.default`, and
your fallback model — and how Skiller resolves them.

## 1. Set a default model

`models.default` is the model every step uses unless it says otherwise. The `greeter` example
skill pins it to `gpt-4o`:

```yaml
models:
  default: gpt-4o
```

Omit `models` entirely and every step uses your [fallback model](#the-fallback-model).
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

## The fallback model

Each step resolves its model in order: the step's `model`, then `models.default`, then your
**fallback model**. The fallback is chosen once per run:

1. the [`skiller.model.default`](../../reference/settings/#skillermodeldefault) setting, if it names
   a model you have;
2. otherwise the model you picked on an earlier run;
3. otherwise Skiller asks — **Choose a model for Skiller runs** — and remembers your pick.

The skill's own configuration always wins: nothing outside the manifest overrides a model the
skill names. To try a skill against another model, change `models.default` (or a step's `model`),
or — for steps that name none — change `skiller.model.default`.

## Fallback and date-suffixed IDs

When a step asks for a model that your language model provider does not expose under that exact ID,
Skiller does not fail outright:

- It matches **date-suffixed IDs** — a configured `gpt-4o` resolves a provider model published
  as `gpt-4o-2024-08-06`, so manifests stay readable as providers append dated revisions.
- If no match is found, Skiller uses your fallback model for that step and warns you
  (*model 'x' isn't available for step 'y'; using 'z'*), rather than aborting the run.

The model picker shows each model's `vendor/family/id`; the last part is the exact id to put in
`models.default`, `models.aliases`, or `skiller.model.default`.

## Related

- **Reference:** [`skill.yaml` manifest](../../reference/skill-yaml/#models) — the `models`
  schema and per-step `model` field.
- **Reference:** [Settings](../../reference/settings/#skillermodeldefault) — `skiller.model.default`.
- **Concept:** [Step types](../../concepts/step-types/) — where the per-step `model` lives and how
  each `llm` step is resolved.
