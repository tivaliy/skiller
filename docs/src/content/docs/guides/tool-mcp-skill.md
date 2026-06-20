---
title: Build a tool/MCP skill
description: Make a skill that writes files and calls your MCP tools, end to end.
sidebar:
  order: 1
---

This guide builds a complete skill that **drafts text with the model and then writes it to a file** —
end to end, with **zero MCP setup**. It uses the built-in [`skiller_createFile`](../../reference/built-in-tools/)
tool, so it runs out of the box. The second half shows how to swap in a real MCP tool you have
configured in VS Code.

By the end you will have a working `note-writer` skill and understand the two ways skills use tools:

- a **`tool` step** that invokes one tool directly with templated parameters, and
- an **agentic `llm` step** that lets the model decide whether and when to call tools.

## What you are building

A two-step skill:

1. An `llm` step asks the model to draft a short note and return it as JSON.
2. A `tool` step writes that draft to a file with `skiller_createFile`.

The `tool` step never talks to the model — it calls one tool with the parameters you give it. That is
the key difference from an agentic `llm` step, which you will meet [below](#call-a-real-mcp-tool).

## Step 1 — Create the skill folder

Skills are folders discovered under `.skiller/skills/` in your workspace. Create one:

```
.skiller/skills/note-writer/
├── skill.yaml
└── steps/
    └── 01-draft.md
```

The folder name (`note-writer`) becomes the skill's default `id`.

## Step 2 — Write the draft prompt

Create `steps/01-draft.md`. Ask the model to return JSON so the next step can read individual fields:

```markdown
---
id: draft
description: Draft a short note as JSON
---
Write a short note about {{ inputs.topic }}.

Reply with ONLY a JSON object, no prose and no code fence:
{ "title": "<a short title>", "text": "<two or three sentences>" }
```

When an `llm` reply is valid JSON, Skiller parses it into an object, so `{{ outputs.draft.title }}` and
`{{ outputs.draft.text }}` resolve to the fields above. If the reply is *not* valid JSON it is stored
as a raw string — and then `{{ outputs.draft.text }}` renders **empty** instead of erroring. That is
the JSON-fallback trap; [Debug a skill](../debugging/) explains how to spot it.

## Step 3 — Write the manifest

Create `skill.yaml`. It collects a `topic`, drafts the note, then writes it. The `tools.aliases` map is
the bridge between a friendly name you use in steps (`create_file`) and the real tool
(`skiller_createFile`):

```yaml
# .skiller/skills/note-writer/skill.yaml
name: Note Writer
description: Draft a short note and write it to a file
version: "1.0.0"

inputs:
  - name: topic
    type: string
    required: true
    prompt: "What should the note be about?"

tools:
  aliases:
    create_file: skiller_createFile     # alias -> built-in LM tool

steps:
  - id: draft
    type: llm
    file: steps/01-draft.md
    output: draft

  - id: save
    type: tool
    tool: create_file
    params:
      filePath: "notes.md"
      content: "{{ outputs.draft.text }}"
    output: saved

on_error: abort

output:
  summary: "Saved your note to notes.md."
```

The `save` step calls the `create_file` alias and passes two `params`, both
Liquid-interpolated. `filePath` is relative, so the file lands in your workspace root. Because
`skiller_createFile` is **workspace-confined**, a path that escapes the workspace is rejected unless you
opt in via [`skiller.skills.allowOutsideWorkspaceWrites`](../../reference/settings/).

A `tool` step takes only `tool` and `params`. It must **not** carry `tools` or `tool_mode` — those
belong to agentic `llm` steps.

## Step 4 — Run it

Reload so Skiller picks up the new folder, then launch the skill:

```
@skiller /reload
@skiller /skill note-writer topic="our release process"
```

The `draft` step calls the model; the `save` step writes `notes.md` to your workspace and reports the
resolved path. Open `notes.md` to confirm the text is there. The whole run animates in the
[live execution graph](../../concepts/execution-graph/) as each step fires.

:::tip
To edit an existing file across several steps instead of overwriting it, alias
`skiller_replaceInFile` the same way and call it from a later `tool` step. See
[Built-in tools](../../reference/built-in-tools/).
:::

## Call a real MCP tool

The skill above needs no MCP server. To use a tool from an MCP server you have configured in VS Code,
alias it the same way — then let an **agentic `llm` step** decide when to call it. Confirm the tool is
visible to Skiller first:

```
@skiller /tools
```

That lists every tool Skiller can see, including ones from your MCP servers. Use the exact name it
shows as the alias target. Here the model researches a topic and may call a search
tool while it works:

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

Here the `tools` list on the **step** says which aliases the model is allowed to call during that step.
The model runs an agentic loop: it may call `search`, read the result, call it again, and keep going
until it produces a final reply — stored under `output: findings`.

### `tool_mode`: auto vs required

- **`auto`** — the model decides whether to call a tool. It might answer directly or call `search`
  first. Use this for "help if you need it" steps.
- **`required`** — the model **must** call at least one tool before it can finish. Use this when a step
  is only meaningful with fresh tool data. `required` needs a non-empty `tools` list, or the manifest
  is rejected.

### Optional tools with `?`

A skill that aliases an MCP tool stops being self-contained: if the server is not configured on someone
else's machine, the alias resolves to nothing. Append `?` to a tool name to mark it **optional**:

```yaml
tools:
  aliases:
    search: my_mcp_searchTool?     # optional — trailing "?"
```

When an optional tool is missing, the step that depends on it is **skipped** rather than failing the
whole skill — and the skip shows in the execution graph. Without the `?`, a missing tool is an error.
This lets you ship a skill that *enhances* itself with an MCP tool when present but still runs without
it.

## Related

- **Reference:** [Built-in tools](../../reference/built-in-tools/) — `skiller_createFile` /
  `skiller_replaceInFile` parameters and workspace confinement.
- **Reference:** [skill.yaml manifest](../../reference/skill-yaml/) — the `tool` step, `tools.aliases`,
  and `tool_mode` schema.
- **Concept:** [Step types](../../concepts/step-types/) — `llm`, `confirmation`, and `tool`, and how
  `outputs` carry state between them.
