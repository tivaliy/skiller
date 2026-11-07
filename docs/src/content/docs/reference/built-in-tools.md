---
title: Built-in tools
description: Skiller's language-model tools — the file tools, skiller_writeSkill, and the Copilot-facing skiller_listSkills and skiller_runSkill.
sidebar:
  order: 5
---

Skiller ships three language-model tools that write to the filesystem: the file tools
`skiller_createFile` and `skiller_replaceInFile`, and [`skiller_writeSkill`](#skiller_writeskill),
which writes a whole new skill. They are always available — no MCP server to configure — so a skill
can produce files with **zero setup**. Use the file tools from a `tool` step in a skill, or reference
them in a Copilot chat (`#createFile`, `#replaceInFile`).

Two more tools let Copilot (or any agent) run your skills: [`skiller_listSkills` and
`skiller_runSkill`](#skiller_listskills-and-skiller_runskill).

## Why these exist

Copilot's own file-editing tools (such as `copilot_createFile` and `copilot_editFiles`) need a VS
Code chat session and fail when a Skiller run calls them. A skill that references them fails its
readiness check, which points you at Skiller's file tools instead; the same goes for the other
chat-only tools (Copilot's subagents and interactive prompts). Skiller's file tools work in any
context — inside a skill's `tool` or `llm` step, and from Copilot chat.

In a skill run, every tool call asks for approval first — Skiller's file tools with their own
**Create File** / **Replace in File** wording and a preview. See
[Tool approvals](../../guides/running-skills/#tool-approvals).

## Workspace confinement

By default, both file tools refuse to write **outside the open workspace folder**. A path that escapes the
workspace — via `..`, an absolute path elsewhere, or a different drive — is rejected, which guards
against a shared or forked skill targeting arbitrary paths like `~/.ssh/config`.

To allow writes anywhere, set [`skiller.skills.allowOutsideWorkspaceWrites`](../settings/) to `true`.
With no workspace folder open and the setting off, the tools error rather than fall back to writing
relative to an unknown location.

:::caution
`skiller.skills.allowOutsideWorkspaceWrites` is a security control. Leave it `false` unless you
explicitly trust every skill that can run, since it lets the file tools write anywhere on disk.
:::

## `skiller_createFile`

Creates a file at the given path with the given content, overwriting it if it already exists. Parent
directories are created as needed.

| Parameter  | Type     | Required | Description |
|------------|----------|----------|-------------|
| `filePath` | `string` | yes      | Where to create the file. Absolute, or relative to the workspace folder. |
| `content`  | `string` | yes      | The full text to write. An empty string creates an empty file. |

Returns a confirmation message with the resolved path on success, or an error message (for example,
when the path escapes the workspace).

Calling it from a `tool` step through a [`tools.aliases`](../skill-yaml/) entry:

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

## `skiller_replaceInFile`

Replaces **every** occurrence of an exact search string with a replacement string inside an existing
file. Prefer it over rewriting the whole file when a skill edits a document across several steps — it
avoids re-sending the entire content each time. It errors if the file does not exist or if the search
string is not found.

| Parameter  | Type     | Required | Description |
|------------|----------|----------|-------------|
| `filePath` | `string` | yes      | The file to modify. Absolute, or relative to the workspace folder. |
| `search`   | `string` | yes      | The exact text to find. Every match is replaced (not a regex). |
| `replace`  | `string` | yes      | The text to substitute for each match. |

A common pattern is to seed a file with `[[PLACEHOLDER]]` markers via `skiller_createFile`, then have
later steps swap each marker for generated content:

```yaml
tools:
  aliases:
    replace_in_file: skiller_replaceInFile
steps:
  - id: fill-summary
    type: tool
    tool: replace_in_file
    params:
      filePath: "report.md"
      search: "[[SUMMARY]]"
      replace: "{{ outputs.summary }}"
    output: filled
```

## `skiller_writeSkill`

Writes a complete new skill folder in one step. It is the tool the built-in `skill-creator` skill
uses, and **among skills, only Skiller's built-in skills may use it**: a workspace or user skill
that references it (in `tools.aliases` or a step) fails its readiness check and does not run, and
a step that offers or calls it anyway (for example through a step file's frontmatter `tools:`) fails
when it runs. It is not referenceable from chat prompts. Like any registered tool, other VS Code
extensions and agents can still call it.
Skiller validates the skill with the same checks as a run first — if anything fails, **nothing is
written** and the errors come back as text so the model can fix them and call again.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `string` | yes | The skill id: letters, digits, `-` and `_`, starting with a letter. Becomes the folder name. |
| `files` | `array` | yes | Every file of the skill, as `{ path, content }` with `path` relative to the skill folder (for example `skill.yaml` or `prompts/main.md`). |

File paths must be relative to the skill folder: no absolute paths, no `..`, no empty segments, no
characters Windows forbids (`< > : " | ? *`), no reserved Windows names (`CON`, `NUL`, `COM1`, …),
and each path only once. Only `.yaml`, `.yml`, and `.md` files are accepted, and `skill.yaml` is
required.

On success it returns `Skill written: …`; on failure, `Skill not written:` followed by the problems.
The folder lands in `.skiller/skills/<id>/` (the user folder when no workspace is open), and the
ids must be unique across tiers. During a `skill-creator` run it asks no further confirmation —
you already approved the plan. Called from anywhere else, it asks first (**Write Skiller skill**,
listing the files).

## Where to use them

- **In a skill** — alias a tool under [`tools.aliases`](../skill-yaml/) and call it from a `tool`
  step. The step's `params` are Liquid-interpolated, so you can wire in `{{ inputs.* }}` and
  `{{ outputs.* }}` values.
- **In Copilot chat** — both file tools are referenceable in a prompt (`#createFile`, `#replaceInFile`),
  so the model can call them while answering a request.

## `skiller_listSkills` and `skiller_runSkill`

These two tools are how Copilot runs your skills; Skiller's `/skiller` chat plugin teaches Copilot to
use them. See [Use Skiller from Copilot](../../guides/use-from-copilot/).

| Tool | Input | Returns |
| ---- | ----- | ------- |
| `skiller_listSkills` (`#listSkills`) | none | A JSON array of the runnable skills: `id`, `name`, `description`, `inputs` (`name`, `type`, `description`, `required`, `editorBound`), and `writesToEditor`. |
| `skiller_runSkill` (`#runSkill`) | `id`, optional `inputs` (by name) | The run's result summary and where its output was delivered — or why it failed, was cancelled, or didn't start. |

`skiller_runSkill` always asks before it starts (**Run Skiller skill**, with any input values shown as
JSON). The run itself is a normal native run in VS Code. The tool waits up to 10 minutes; after that
it returns *"The run continues in VS Code; see the graph panel for the result."* and the run keeps
going.

Both are for agents outside a Skiller run. Skiller runs one skill at a time, so a skill can't use
them: referencing either in `skill.yaml` fails the readiness check (*"Tool 'skiller_runSkill' can't be
used inside a Skiller run."*), and a step that offers one anyway — for example through step-file
frontmatter — fails when it runs. The same runtime check applies to chat-only tools.

## Related

- [Build a tool/MCP skill](../../guides/tool-mcp-skill/) — a full, copyable skill that drafts text
  and writes it with `skiller_createFile`.
- [skill.yaml reference](../skill-yaml/) — the `tool` step and `tools.aliases` schema.
- [Settings](../settings/) — `skiller.skills.allowOutsideWorkspaceWrites`.
- [Use Skiller from Copilot](../../guides/use-from-copilot/) — `/skiller`, `skiller_listSkills`, and `skiller_runSkill`.
