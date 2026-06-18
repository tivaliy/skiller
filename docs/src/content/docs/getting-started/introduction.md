---
title: Introduction
description: What Skiller is — a declarative, human-in-the-loop workflow runner for VS Code chat.
sidebar:
  order: 1
---

Skiller runs **skills** — declarative, multi-step workflows defined in YAML and Markdown. Each
skill is a playbook: a sequence of steps that call a language model, invoke your
[MCP](https://modelcontextprotocol.io) tools, and pause for your input or approval exactly where
you tell them to.

It is deliberately **not** a free-form agent: *you* define the steps and the model fills them in, it
runs **only** the steps you wrote (pausing for confirmation where you ask), and the same playbook
produces the same shape every run.

## What a skill looks like

A skill is a folder with a `skill.yaml` manifest and one Markdown file per model prompt:

```
.skiller/skills/commit-message/
├── skill.yaml          # inputs, steps, and wiring
└── steps/
    └── 01-draft.md     # a Liquid-templated prompt
```

The manifest is small and readable — an input, a couple of steps, and where to pause (abridged;
you'll build the full version on the next pages):

```yaml
name: Commit Message
inputs:
  - name: summary
    prompt: "What changed?"
steps:
  - id: draft
    type: llm
    file: steps/01-draft.md
    output: draft
  - id: review
    type: confirmation
    message: "{{ outputs.draft.message }}"
    options:
      - { label: "Looks good", action: continue }
      - { label: "Try again",  action: goto, goto_step: draft }
```

## Next steps

- [Install Skiller](../installation/) in VS Code.
- [Run a bundled skill](../first-skill/) to see one work end to end.
- [Write your first skill](../write-your-first-skill/) — build the one above, for real.
