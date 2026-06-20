---
title: Write your first skill
description: Build a small, real skill from scratch — a manifest, a prompt step, a human-in-the-loop confirmation — and run it in chat.
sidebar:
  order: 4
---

You ran the built-in example skills in the previous step. Now you'll author one yourself: a
**greeter** that asks for your name, drafts a friendly greeting, **pauses** so you can decide
whether to continue, then offers a fun fact. It stays entirely in chat and needs no MCP tools — a
complete skill in two small files.

This is the same `greeter` that ships with Skiller. Building it yourself shows you every moving
part: the folder layout, the manifest, a Liquid-templated prompt, a `confirmation` gate, and
per-step state through `outputs`.

## 1. Create the skill folder

A skill is a folder. Skiller discovers workspace skills under `.skiller/skills/<id>/`, and the
folder name is the skill's default `id`. Create:

```
.skiller/skills/greeter/
├── skill.yaml
└── steps/
    ├── 01-greet.md
    └── 02-fact.md
```

The workspace tier wins over the user tier and the built-in skills, so a `greeter` you author here
takes precedence — see [Skills & discovery](../../concepts/skills-and-discovery/).

## 2. Write the manifest

The manifest is a strict-schema YAML file. It names the skill, declares the `inputs` collected
before the run, and lists the typed `steps` that execute in order.

`.skiller/skills/greeter/skill.yaml`:

```yaml
# .skiller/skills/greeter/skill.yaml
id: greeter
name: Greeter
description: A simple greeting workflow demonstrating multi-step skills with confirmation
version: "1.1.0"          # any semver string — it's just metadata

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

:::note[Don't have `gpt-4o` in your model list?]
The model IDs here are just examples. If your provider's `/models` list doesn't include `gpt-4o`
or `gpt-4.1`, Skiller falls back to your selected chat model (and shows a banner) — the skill still
runs. See [Use & override models](../../guides/models/) to pin your own.
:::

What each part does:

- **`inputs`** are collected before the skill runs. The `prompt` is the question you're asked in
  chat; the answer lands at `{{ inputs.name }}`.
- **`models.default`** sets the model for the whole skill. The `fact` step overrides it with
  `model: gpt-4.1` — see [Use & override models](../../guides/models/).
- **`steps`** run top to bottom. Each step has a unique `id` and writes to a unique `output`. The
  `greet` step's `greeting` is what the `confirm` step interpolates and what you see in the gate.
- **`confirmation`** pauses for a human choice. `continue` proceeds to the next step; `abort` stops
  the run cleanly. Your click is recorded at `outputs.user_choice` as an object — see
  [Step types & state](../../concepts/step-types/).
- **`output.summary`** is the final message shown when the skill finishes.

:::note
The schema is strict: unknown keys are rejected with a did-you-mean suggestion, and keys are
snake_case (`on_error`). The `type` of every step is required — there is no default. The full
field-by-field listing lives in the [`skill.yaml` reference](../../reference/skill-yaml/).
:::

## 3. Write the prompt

Each `llm` step points at a Markdown file rendered with [Liquid](https://liquidjs.com/) — a small
templating language. In skills you'll mostly use `{{ ... }}` to insert values, plus `{% if %}` /
`{% for %}` for logic. The prompt can read `{{ inputs.* }}` and any earlier step's
`{{ outputs.* }}`.

`.skiller/skills/greeter/steps/01-greet.md`:

```markdown
---
id: greet
description: Generate a personalized greeting
---
Generate a warm, friendly greeting for {{ inputs.name }}.
Keep it to one sentence.
```

The block between the `---` fences is **step-file frontmatter**. Here it carries `id` and
`description`; it can also hold a step's `tool` / `tools` / `tool_mode` / `requires` so a step's
tool config sits next to its prompt. The frontmatter `id` is for your own reference — it does
**not** have to match the step `id` in the manifest. See the
[Step-file frontmatter reference](../../reference/step-frontmatter/) for the full set of keys.

Add a second prompt for the optional fun fact, `.skiller/skills/greeter/steps/02-fact.md`:

```markdown
---
id: fact
description: Generate a fun fact
---
Share one short, surprising fun fact related to the name {{ inputs.name }}.
Keep it to one or two sentences.
```

## 4. Run it

In the Chat view:

```text
@skiller /reload          Pick up the new skill (reports added/removed/errors)
@skiller /skill greeter   Run it
```

Skiller asks **"What is your name?"**, drafts a greeting, then pauses on the confirmation. Pick
**Yes, give me a fun fact** to continue to the `fact` step, or **No thanks, just the greeting** to
stop. To watch it visually, open the [live execution graph](../../concepts/execution-graph/) first —
click the **Show Graph** CodeLens above your `skill.yaml` (or run `@skiller /skills greeter`) — then
run the skill and watch `greet → confirm → fact` light up as each step fires.

You can also skip the prompt by passing the input up front:

```text
@skiller /skill greeter name=Ada
```

## 5. Watch the templating

While authoring, set **`skiller.skills.verboseMode`** to `"rendered"` in VS Code settings to see
each prompt *after* Liquid interpolation alongside the model's reply — the fastest way to confirm a
template resolves the way you expect. Set it to `"raw"` to see the raw model exchange instead. You
can also hover any step in the live execution graph to inspect its fully-interpolated prompt and
response. See [Debug a skill](../../guides/debugging/).

## A note on JSON replies

`greeter`'s `llm` steps return plain text, so `outputs.greeting` is just a string. But when an
`llm` reply *is* valid JSON, Skiller parses it automatically so a later step can read nested
fields — for example a `draft` step that returns `{ "message": "..." }` lets you interpolate
`{{ outputs.draft.message }}`.

:::caution[The JSON-fallback trap]
If you expect JSON but the model returns something that isn't valid JSON, Skiller does **not**
error — it silently stores the reply as a raw string. A later `{{ outputs.draft.message }}` then
renders **empty** instead of failing, which is easy to miss. When a step must return JSON, say so
explicitly in the prompt (for example, "Reply with ONLY JSON: `{ "message": "..." }`") and, while
debugging, use `verboseMode: "raw"` to see exactly what the model returned. More in
[Step types & state](../../concepts/step-types/).
:::

## What you learned

- A skill is a folder: a `skill.yaml` manifest plus one Markdown prompt per `llm` step.
- `inputs` are collected up front; a `confirmation` step pauses for a human choice.
- State flows only through `outputs` — steps share no conversation history.
- A per-step `model` overrides `models.default`, and valid-JSON replies are parsed into objects.

## Next steps

- **Add a tool step** that writes a file with zero MCP setup — [Build a tool/MCP skill](../../guides/tool-mcp-skill/).
- **Branch and loop** with confirmation `goto` — [Branch & loop with confirmations](../../guides/branching-looping/).
- **Understand the model** behind it all — [Step types & state](../../concepts/step-types/) and
  [Templating with Liquid](../../concepts/templating/).
- **Look up every field** — the [`skill.yaml` reference](../../reference/skill-yaml/).
