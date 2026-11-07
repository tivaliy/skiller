---
title: Built-in tools
description: The skiller_createFile, skiller_replaceInFile, and skiller_writeSkill language-model tools.
sidebar:
  order: 5
---

Skiller ships three language-model tools that write to the filesystem: the file tools
`skiller_createFile` and `skiller_replaceInFile`, and [`skiller_writeSkill`](#skiller_writeskill),
which writes a whole new skill. They are always available — no MCP server to configure — so a skill
can produce files with **zero setup**. Use the file tools from a `tool` step in a skill, or reference
them directly in chat (e.g. `@skiller #createFile`).

## Why these exist

VS Code's built-in file-editing tools (such as `copilot_createFile`) rely on internal Copilot chat
context that is **not** passed to third-party chat participants when they are invoked through the
Language Model Tools API. Calling them from `@skiller` fails (for example, with an "Invalid stream"
error). Skiller therefore ships its own file tools that work reliably in any context — both inside a
skill's `tool` step and when invoked from chat.

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
when it runs. It is not referenceable from chat prompts. Like any registered tool, other VS Code extensions can still
call it programmatically.
Skiller validates the skill with the same checks as `/skill` first — if anything fails, **nothing is
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
ids must be unique across tiers. It asks no confirmation, since you already asked for the skill;
that is why skills other than the built-ins may not call it.

## Where to use them

- **In a skill** — alias a tool under [`tools.aliases`](../skill-yaml/) and call it from a `tool`
  step. The step's `params` are Liquid-interpolated, so you can wire in `{{ inputs.* }}` and
  `{{ outputs.* }}` values.
- **In chat** — both file tools are referenceable in a prompt (`#createFile`, `#replaceInFile`), so the
  model can call them while answering a request.

## Related

- [Build a tool/MCP skill](../../guides/tool-mcp-skill/) — a full, copyable skill that drafts text
  and writes it with `skiller_createFile`.
- [skill.yaml reference](../skill-yaml/) — the `tool` step and `tools.aliases` schema.
- [Settings](../settings/) — `skiller.skills.allowOutsideWorkspaceWrites`.
