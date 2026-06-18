---
title: Write your first skill
description: Build a small, real skill from scratch — a commit-message drafter with a human-in-the-loop review loop.
sidebar:
  order: 4
---

You'll build a **commit-message drafter**: it takes a one-line summary of a change, asks the model
to write a [Conventional Commits](https://www.conventionalcommits.org) message, then **pauses** so
you can accept it, regenerate it, or cancel. It stays entirely in chat and needs no MCP tools — a
complete skill in two small files.

## 1. Create the skill folder

Skills live in `.skiller/skills/<id>/` in your workspace. Create:

```
.skiller/skills/commit-message/
├── skill.yaml
└── steps/
    └── 01-draft.md
```

## 2. Write the manifest

`.skiller/skills/commit-message/skill.yaml`:

```yaml
name: Commit Message
description: Draft a Conventional Commits message from a short summary of your change.
version: "1.0.0"

# Collected before the skill runs. `prompt` is the question you're asked in chat.
inputs:
  - name: summary
    type: string
    required: true
    prompt: "What changed? (a sentence or two)"

steps:
  # 1. Ask the model to draft a message. It replies with JSON, which Skiller
  #    parses — so the next step can read outputs.draft.message.
  - id: draft
    type: llm
    file: steps/01-draft.md
    output: draft

  # 2. You review it. "Looks good" finishes; "Try again" loops back to `draft`;
  #    "Cancel" stops. Your click is recorded at outputs.review.selectedOption.
  - id: review
    type: confirmation
    message: |
      ## Proposed commit message

      ```
      {{ outputs.draft.message }}
      ```
    options:
      - { label: "Looks good", action: continue }
      - { label: "Try again",  action: goto, goto_step: draft }
      - { label: "Cancel",     action: abort }
    output: review

output:
  summary: "✅ Copy the message above — you're done."
```

## 3. Write the prompt

Each `llm` step points at a Markdown file rendered with [Liquid](https://liquidjs.com/) — a small
templating language; in skills you'll mostly use `{{ ... }}` to insert values (plus `{% if %}` /
`{% for %}` for logic). The prompt can read `{{ inputs.* }}` and any earlier step's `{{ outputs.* }}`.

`.skiller/skills/commit-message/steps/01-draft.md`:

```markdown
---
id: draft
description: Draft a Conventional Commits message
---

Write a single Conventional Commits message for this change:

"{{ inputs.summary }}"

Rules:
- Format: `type(scope): description` (scope optional), lower-case, no trailing period.
- Use a type such as feat, fix, docs, refactor, test, or chore.

Reply with ONLY JSON: { "message": "your commit message" }
```

Because the reply is valid JSON, Skiller parses it — which is why `{{ outputs.draft.message }}` in
the manifest resolves to the `message` field. (Skiller also handles JSON wrapped in a code fence or
surrounded by prose — it extracts it; if a reply isn't JSON at all, `outputs.draft` is just the raw
text string.) Steps don't share conversation history; state flows only through `outputs` (see
[Step types](../../concepts/step-types/)).

## 4. Run it

In the Chat view:

```text
@skiller /reload                 Pick up the new skill
@skiller /skill commit-message   Run it
```

Skiller asks **"What changed?"**, drafts a message, then shows your three options. Pick **Try again**
to regenerate (it loops back to `draft`) or **Looks good** to finish. The live execution graph opens
in a side panel as it runs — watch `draft → review` and the loop back light up.

You can also skip the prompt by passing the input up front:

```text
@skiller /skill commit-message summary="fix the login redirect on expired sessions"
```

## 5. Watch the templating (optional)

While authoring, set **`skiller.skills.verboseMode`** to `rendered` in VS Code settings to see each
prompt *after* interpolation and the model's raw reply — the fastest way to debug a template.

## What you learned

- A skill is a `skill.yaml` plus one Markdown prompt per `llm` step.
- `inputs` are collected up front; `confirmation` steps pause for a human choice and can `goto`.
- State flows through `outputs`, and JSON replies are parsed so you can read nested fields.

Next: keep the [`skill.yaml` reference](../../reference/skill-yaml/) handy for every field you can
use, or read [step types](../../concepts/step-types/) in depth.
