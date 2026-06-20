---
title: Templating with Liquid
description: How Liquid templates resolve inputs, outputs, and the built-in context.
sidebar:
  order: 3
---

Every prompt file, `confirmation` message, `tool` param, `when` condition, and `output.summary`
in a skill is a **Liquid template**. Skiller renders them with [LiquidJS](https://liquidjs.com/)
just before each step runs, so the text the model (or the file tool) actually sees is the
interpolated result — not the raw `{{ ... }}` source.

This is the only way data moves between steps. Steps share no conversation history; a later step
reads an earlier one solely by templating its output. (See
[Step types & state](../step-types/) for why.)

## The two variables you use most

`{{ inputs.* }}` resolves the values collected from the skill's `inputs`, and `{{ outputs.* }}`
resolves the value a previous step stored under its `output` name.

```markdown
Generate a warm, friendly greeting for {{ inputs.name }}.
Keep it to one sentence.
```

When an `llm` step's reply is valid JSON, Skiller parses it into an object, so you can reach into
its fields with dotted paths:

```markdown
Your previous question was: "{{ outputs.turn.question }}"
The player answered: **{{ outputs.reply.selectedOption }}**
```

## Logic: conditionals, loops, and filters

Liquid gives you real control flow inside a template, not just substitution.

```markdown
{% if outputs.final %}
Note: you already guessed **"{{ outputs.final.guess }}"** and it was WRONG.
{% endif %}

{% for fact in outputs.research.facts %}
- {{ fact }}
{% endfor %}

Topic: {{ inputs.topic | upcase }}   ({{ outputs.research.facts | size }} facts)
```

Filters such as `upcase`, `size`, `default`, and `truncate` are standard LiquidJS — see the
[LiquidJS filter reference](https://liquidjs.com/filters/overview.html) for the full set.

## The built-in context

Beyond `inputs` and `outputs`, every template can read this metadata about the running skill:

| Variable | What it is |
|---|---|
| `skill.id` | The skill's id |
| `skill.name` | The skill's display name |
| `skill.version` | The skill's `version` string |
| `workspaceFolder` | Absolute path of the first workspace folder (empty if none) |
| `currentStep` | Zero-based index of the step being rendered (the first step is `0`) |
| `totalSteps` | Total number of steps in the skill |
| `startTime` | Epoch milliseconds when the run started |
| `stepTimes` | Map of step id → execution time (ms) |
| `availableMcps` | List of MCP categories available in this run |

For example, a prompt can ground the model in the current project:

```markdown
You are working in the project at {{ workspaceFolder }}.
This is step {{ currentStep | plus: 1 }} of {{ totalSteps }} in {{ skill.name }}.
```

## Top-level flattening

For convenience, every key under `inputs` and `outputs` is **also** exposed unprefixed at the top
level. So `{{ name }}` is equivalent to `{{ inputs.name }}`, and `{{ draft.title }}` is equivalent
to `{{ outputs.draft.title }}`.

A key is flattened only when it doesn't collide with a reserved variable (`inputs`, `outputs`,
`skill`, `workspaceFolder`, `currentStep`, `totalSteps`, `startTime`, `stepTimes`, `availableMcps`);
and if an input and an output share a name, the **input** takes the unprefixed slot. The namespaced
forms avoid this ambiguity and read more clearly — prefer them in shared skills; the flattened form
is handy for quick one-offs.

## Strict in prompts, permissive in `when`

Skiller renders templates in two modes, and the difference matters.

- **Prompts, messages, params, `output.summary` — strict.** An undefined variable throws and
  fails the step rather than silently rendering empty. This is deliberate: a typo'd
  `{{ outputs.draftt }}` should surface as an error, not ship an empty prompt to the model.
- **`when` conditions — permissive.** A missing variable evaluates to falsy instead of throwing,
  so you can branch on outputs that may not exist yet. `when: outputs.research` is `false` on a
  run where `research` never produced a value, and the step is skipped.

:::caution[The JSON-fallback trap]
When an `llm` reply is **not** valid JSON, Skiller stores it as a raw string instead of an object.
Reaching into it with `{{ outputs.x.field }}` then renders **empty** (the string has no `field`
property) rather than throwing. If a downstream prompt comes out blank, suspect a malformed-JSON
reply first — turn on `skiller.skills.verboseMode` to inspect the exact text. See
[Debug a skill](../../guides/debugging/).
:::

## The first-turn guard pattern

Because `when` is permissive and undefined is falsy, the same prompt file can serve both the first
iteration of a loop (when nothing exists yet) and later iterations (when prior output is present).
Guard the parts that depend on earlier output with `{% if outputs.x %}`:

```markdown
{% if outputs.turn %}
Here is everything you have learned so far (your running notes):

{{ outputs.turn.notes }}

Your previous question was: "{{ outputs.turn.question }}"
The player answered: **{{ outputs.reply.selectedOption }}**
{% else %}
This is your very first question — you know nothing yet, so start broad.
{% endif %}
```

On the first pass `outputs.turn` is undefined, the `{% else %}` branch renders, and the prompt
starts fresh. On every loop afterward the carried-forward notes render instead. This is exactly
how the `mind-reader` example skill threads state through a `goto` loop — see
[Branch & loop with confirmations](../../guides/branching-looping/).

## Related

- **Reference:** [`skill.yaml` manifest](../../reference/skill-yaml/) — where each templated field
  lives in the schema.
- **Concept:** [Step types & state](../step-types/) — why `outputs.<name>` is the only channel
  between steps, and the JSON auto-parse behavior in depth.
