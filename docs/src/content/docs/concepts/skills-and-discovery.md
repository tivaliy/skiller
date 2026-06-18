---
title: Skills & discovery
description: What a skill is, and how Skiller discovers workspace, user, and built-in skills.
sidebar:
  order: 1
---

A **skill** is a directory containing a `skill.yaml` manifest and one or more Liquid-templated step
files (one per `llm` step).

## Layered discovery

Skills are discovered from three sources, in precedence order (earlier wins):

1. **Workspace** — `.skiller/skills/` in your repo root
2. **User** — `~/.vscode/skiller/skills/`
3. **Built-in** — the skills bundled with the extension (`greeter`, `mind-reader`)

A skill with the same `id` in your workspace overrides the user copy, which overrides the built-in
one.

## Fork a bundled skill

Because workspace skills win, you can **fork** any bundled skill: copy it into
`.skiller/skills/<id>/` (keeping the same `id`) and edit it — your version takes over. It's a good
way to start from something that already works. Run `@skiller /reload` after editing to pick up
changes.
