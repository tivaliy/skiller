---
title: Introduction
description: What Skiller is — a declarative, human-in-the-loop workflow runner for VS Code.
sidebar:
  order: 1
---

Skiller runs **skills**: declarative, multi-step workflows you define in YAML and Markdown and
run right in VS Code — from the Command Palette, the editor, a code action, or Copilot chat. Each skill is a playbook — a sequence of typed steps
that call a language model, invoke your [MCP](https://modelcontextprotocol.io) tools, and pause for
your input or approval exactly where you tell them to.

If you have read the [home page](../../), you have the pitch: Skiller is the deliberate opposite of a
free-form agent. This page shows you what a skill actually looks like and how you run one, then
points you at installation.

## What a skill looks like

A skill is a folder with a `skill.yaml` manifest and one Markdown file per model prompt:

```
.skiller/skills/greeter/
├── skill.yaml          # inputs, steps, and wiring
└── steps/
    ├── 01-greet.md     # a Liquid-templated prompt
    └── 02-fact.md
```

The manifest is small and readable. Here is the start of the built-in `greeter` skill — an input,
an `llm` step that drafts a greeting, and a `confirmation` step that pauses for your choice
(abridged; you will build the full version on the next pages):

```yaml
id: greeter
name: Greeter
description: A simple greeting workflow demonstrating multi-step skills with confirmation

inputs:
  - name: name
    type: string
    description: Your name
    required: true
    prompt: "What is your name?"

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
      - { label: "Yes, give me a fun fact",      action: continue }
      - { label: "No thanks, just the greeting", action: abort }
    output: user_choice
```

The `{{ outputs.greeting }}` reference is [Liquid templating](../../concepts/templating/): each step can
read the output of an earlier one. Steps run in order, the model fills in the `llm` steps, and the
`confirmation` step stops to wait for you.

## How you run a skill

Skiller is a **skills runner**, not a general-purpose assistant. You start a skill, and it runs the
steps you wrote — nothing more:

- **Skiller: Run Skill…** in the Command Palette or the editor context menu, or a **code action** for
  skills that read your selection, file, or diagnostics.
- **Skiller: New Skill…** to create one — describe it and the built-in `skill-creator` drafts it.
- **Copilot** — ask it, or use `/skiller` in a Copilot chat, and it runs the matching skill for you.

Inputs are asked with pickers; confirmations, tool approvals, and results appear as cards in the
skill's [live execution graph](../../concepts/execution-graph/). Skiller does not improvise its own
steps or hold an open-ended conversation; that predictability is the point. See
[Running skills](../../guides/running-skills/).

## Next steps

- [Install Skiller](../installation/) in VS Code — **start here.**
- [Run a built-in skill](../run-a-bundled-skill/) to see one work end to end.
- [Write your first skill](../write-your-first-skill/) — build the one above, for real.
