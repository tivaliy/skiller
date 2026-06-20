---
title: Installation
description: Install Skiller from the VS Code Marketplace or build it from source.
sidebar:
  order: 2
---

## Requirements

- **VS Code 1.93+**
- A **chat language model provider** — e.g. GitHub Copilot, or any provider that exposes VS Code's
  Language Model API. Skiller runs your skills through whatever model VS Code chat offers; it does
  not ship a model of its own.
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

## Check a model is available

After installing, open the Chat view and run:

```text
@skiller /models
```

If one or more models are listed, you're ready to go. If it's **empty**, set up a provider first —
for example, sign in to GitHub Copilot — then run `/models` again.

The model you pick in the chat model dropdown is the one skills use. Skills can also declare their
own model in `skill.yaml`; for how that interacts with your dropdown choice, see
[Use & override models](../../guides/models/).

## Next

[Run a built-in skill →](../run-a-bundled-skill/)
