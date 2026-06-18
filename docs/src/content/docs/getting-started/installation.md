---
title: Installation
description: Install Skiller from the VS Code Marketplace or build it from source.
sidebar:
  order: 2
---

## Requirements

- **VS Code 1.93+**
- A **chat language model provider** — e.g. GitHub Copilot, or any provider that exposes VS Code's
  Language Model API. Skiller runs your skills through whatever model VS Code chat offers — see
  [Check a model is available](#check-a-model-is-available) below.
- **MCP servers** configured in VS Code — optional, only needed for `tool` steps and tool-using
  `llm` steps.

## From the Marketplace

```text
ext install tivaliy.skiller
```

Or search for **Skiller** in the Extensions view, or open the
[Marketplace listing](https://marketplace.visualstudio.com/items?itemName=tivaliy.skiller).

## From source

```bash
git clone https://github.com/tivaliy/skiller.git
cd skiller
npm install
npm run package
code --install-extension skiller-*.vsix
```

## Check a model is available

Skiller doesn't ship a model of its own — it uses the language models available to VS Code chat.
After installing, open the Chat view and run:

```text
@skiller /models
```

If one or more models are listed, you're ready. If it's **empty**, set up a provider first — for
example, sign in to GitHub Copilot — then run `/models` again. The model you select in the chat
model dropdown is the one skills use; in **Auto** mode, a skill's own `models` config decides
(details in the [`skill.yaml` reference](../../reference/skill-yaml/)).

Once a model shows up, [run a bundled skill](../first-skill/).
