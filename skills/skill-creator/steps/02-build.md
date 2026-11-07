---
id: build
description: Write the skill files
---

You build **Skiller skills**. Turn the approved plan below into a working skill and save it by calling the `skiller_writeSkill` tool. The user approved this plan; do not ask them anything.

## The user's idea

{{ inputs.idea }}

## The approved plan

{{ outputs.plan }}

## Tools the new skill may use

{% if inputs.available_tools %}
{{ inputs.available_tools }}

Use only these names, spelled exactly (through `tools.aliases`). A required tool that is not installed blocks the skill from running, so never use a name that is not on this list. Mark a nice-to-have tool optional with a trailing `?` (see Tools below). If the plan names a tool that is not listed, drop that tool and deliver the result another way (an `output.to` sink or a confirmation).
{% else %}
No installed tools were found. Build the skill without `tools`, `tool` steps, or `tools.aliases`.
{% endif %}

## How to save the skill

Call `skiller_writeSkill` with:
- `id`: the skill id from the plan. It must start with a letter and use only letters, digits, `-` and `_`. It becomes the folder name, and the `id:` line in `skill.yaml` must be exactly the same.
- `files`: every file of the skill, each as `{ path, content }`. Always include `skill.yaml`. Put prompts in `steps/` (`steps/01-draft.md`, `steps/02-save.md`, …). Paths are relative with forward slashes. Content is the raw file text, with no markdown code fences around it.

Keep step files short: a few clear sentences of instructions plus the values they need. Keep the skill as small as the plan allows.

What happens next:
- If the result starts with `Skill written:`, you are done. Reply with one short sentence naming the skill. Do not repeat the files.
- If the result starts with `Skill not written:`, read every `- ` error line, fix each one, and call `skiller_writeSkill` again with the complete corrected set of files (all files, not only the changed ones). Keep the same id unless an error says it already exists; then pick a different id (for example add a suffix) and change the `id:` line in `skill.yaml` to match. Keep going until the skill is written.

## Authoring reference

{% raw %}
### skill.yaml

The schema is strict: unknown keys are rejected and keys are `snake_case` (`on_error`, `tool_mode`, `goto_step`). `name` and at least one step are required; every step needs a unique `id` and a `type`. Quote `version` (`"0.1.0"`).

Top-level keys: `id`, `name`, `description`, `version`, `inputs`, `tools`, `steps`, `on_error` (`abort` or `continue`), `output`.

**Inputs** (read in templates as `{{ inputs.<name> }}`). Fields: `name`, `type` (`string`, `number`, `boolean`, `array`), `description`, `required` (default `true`), `default`, `prompt` (the question shown when the value is asked for), `enum` (list of allowed values), `pattern` (regex), `from`.

`from` fills the input from the editor at launch; if it resolves to nothing, the user is asked (give it a `prompt`). Values:
- `selection`: the selected text
- `activeFile` / `activeFile.content`: the active file's text; `activeFile.path`; `activeFile.language`
- `git.staged`: `git diff --staged`; `git.working`: unstaged changes
- `diagnostics`: the active file's problems, one per line
- `tools`: installed tools, one `name — description` per line

**Steps.** Common fields: `id`, `type`, `description`, `output` (stores the result as `outputs.<name>`; unique), `when` (a bare Liquid expression such as `outputs.findings`, not wrapped in `{{ }}`; the step is skipped when falsy), `requires`.

- `llm`: `file` (a prompt file such as `steps/01-draft.md`) or `message` (inline prompt), exactly one. Optional `tools` (list of aliases the model may call) and `tool_mode`: `auto` (the model decides) or `required` (it must call a tool on its first turn; use with exactly one tool).
- `confirmation`: `message` (Liquid, shown to the user) and `options`, each with `label`, `action` (`continue`, `abort`, or `goto`), and `goto_step` (the target step id, only with `goto`). `goto` can jump backwards (a loop) or forwards (a branch). Its `output` is an object: `{{ outputs.<name>.selectedOption }}` is the chosen label.
- `tool`: `tool` (an alias) and `params` (a map; string values are Liquid templates). No `tools` or `tool_mode` on a tool step.

**Tools.** Map a friendly alias to a real tool name; steps use the alias. A trailing `?` marks a tool optional: if it is missing, the skill still runs without it.

```yaml
tools:
  aliases:
    create_file: skiller_createFile
    search: jira_search?
```

Skiller's own file tools: `skiller_createFile` (params `filePath`, `content`; creates or overwrites) and `skiller_replaceInFile` (params `filePath`, `search`, `replace`).

**Output.** `output.summary` is a Liquid template shown when the run finishes (not shown when a confirmation aborts). `output.to` also delivers it somewhere:
- `newDocument`: a new untitled document
- `file:<path>`: a workspace file, created or overwritten in full
- `editor.replaceSelection`, `editor.insert`: the editor the skill was launched from
- `diff`: a reviewable diff of the launch document; the user clicks Apply
- `terminal`: typed into the terminal, not run; `terminal.run`: typed and run (put a confirmation step before it)

### Step files and Liquid

A step file is optional frontmatter (`id`, `description`) followed by the prompt. The prompt is a Liquid template: `{{ inputs.topic }}` inserts an input, `{{ outputs.draft }}` inserts an earlier step's result.

Liquid is strict: referencing a variable that does not exist fails the step. So:
- Only reference inputs the skill declares, and outputs of steps that have already run.
- An input with `required: false` and no `default` may be empty: wrap it in `{% if inputs.notes %}…{% endif %}`.
- A step reached again through a `goto` loop can read its earlier result, but only inside a guard such as `{% if outputs.decision %}…{% endif %}`.

An llm reply is stored as plain text, unless it is valid JSON, which is parsed so fields can be read as `{{ outputs.turn.question }}`. Use JSON only when a later step or message needs separate fields; then end the prompt with "Respond with only a JSON object, no code fences:" and show the exact keys. Otherwise ask for plain text.

### Complete example

`skill.yaml`:

```yaml
id: release-note
name: Release Note
description: Draft a release note from the staged diff and approve it before it opens
version: "0.1.0"

inputs:
  - name: diff
    type: string
    description: The staged changes
    from: git.staged
    required: true
    prompt: "Paste the diff to describe"

steps:
  - id: draft
    type: llm
    description: Draft the note
    file: steps/01-draft.md
    output: note

  - id: review
    type: confirmation
    description: Approve the note
    message: |
      ## Release note

      {{ outputs.note }}
    options:
      - label: "Use it"
        action: continue
      - label: "Write another"
        action: goto
        goto_step: draft
      - label: "Cancel"
        action: abort
    output: decision

on_error: abort

output:
  summary: "{{ outputs.note }}"
  to: newDocument
```

`steps/01-draft.md`:

```markdown
---
id: draft
description: Draft the note
---
Write a short release note (three to five bullets) for these changes. Return only the note.

{{ inputs.diff }}
{% if outputs.decision %}
The user asked for a different version of this draft:

{{ outputs.note }}
{% endif %}
```
{% endraw %}
