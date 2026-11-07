---
title: Installation
description: Install Skiller from the VS Code Marketplace or build it from source.
sidebar:
  order: 2
---

## Requirements

- **VS Code 1.95+**
- A **language model provider** — e.g. GitHub Copilot, or any provider that exposes VS Code's
  Language Model API. Skiller runs your skills through the models VS Code offers; it does not ship
  a model of its own.
- **MCP servers** configured in VS Code — optional, only needed for `tool` steps and tool-using
  `llm` steps.
- **Node.js (LTS) + npm** — only if you install from source (below); not needed for the Marketplace install.

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

## Choose a model

The first time you run a skill, Skiller asks **Choose a model for Skiller runs** and remembers your
pick. That model is the fallback for every step whose skill doesn't name a model of its own. To set
it up front instead, put a model id in
[`skiller.model.default`](../../reference/settings/#skillermodeldefault).

If a run says **No language models available**, set up a provider first — for example, sign in to
GitHub Copilot — and run the skill again. For how skills pin their own models, see
[Use & override models](../../guides/models/).

## Next

[Run a built-in skill →](../run-a-bundled-skill/)
