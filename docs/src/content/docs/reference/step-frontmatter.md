---
title: Step-file frontmatter
description: The YAML frontmatter accepted at the top of a step prompt file.
sidebar:
  order: 2
---

An `llm` or `confirmation` step can read its prompt from a Markdown file. That file may begin with
an optional YAML frontmatter block, fenced by `---`, followed by the [Liquid](https://liquidjs.com/)
prompt body:

```markdown
---
id: greet
description: Generate a personalized greeting
---
Generate a warm, friendly greeting for {{ inputs.name }}.
Keep it to one sentence.
```

Everything below the closing `---` is the prompt template. The frontmatter is optional — a step file
with no fence is treated as a pure prompt.

## Default file path

A step points at its file with the `file` key in `skill.yaml`. When a step omits `file` and has no
inline `message`, Skiller looks for the file at `steps/NN-<id>.md`, where `NN` is the step's
two-digit position and `<id>` is the step `id`. The first step `greet` resolves to
`steps/01-greet.md`, the second `fact` step to `steps/02-fact.md`, and so on.

Set `file` explicitly to override this convention.

## Keys

| Key | Type | Notes |
| --- | ---- | ----- |
| `id` | string | Step identifier (see note below) |
| `description` | string | Human-readable description of the step |
| `tool` | string | A tool alias the step invokes |
| `tools` | list | MCP tool aliases the model may call |
| `tool_mode` | enum | `auto` (model decides) or `required` (must call a tool) |
| `requires` | list | Step `id`s that must run first |

`tool`, `tools`, `tool_mode`, and `requires` are the same step-level options accepted on a manifest
step. Declaring them in the step file keeps a step's tool configuration next to the prompt it
governs, rather than splitting it across the manifest. See the
[`skill.yaml` reference](../skill-yaml/) for what each option does.

Unlike the strict `skill.yaml` manifest, step-file frontmatter is parsed **leniently** — an
unrecognized key is ignored rather than rejected.

:::note
The frontmatter `id` does **not** have to match the step `id` in `skill.yaml`. The step `id` (and the
order of the `steps` list) is what drives execution and the [`steps/NN-<id>.md`](#default-file-path)
path resolution; the frontmatter `id` is documentation for the prompt file itself.
:::

## Related

- [`skill.yaml` reference](../skill-yaml/) — the manifest that points at each step file.
- [Step types](../../concepts/step-types/) — how `llm`, `confirmation`, and `tool` steps run.
