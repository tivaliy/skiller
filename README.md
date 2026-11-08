<div align="center">

<img src="resources/icon.png" alt="Skiller" width="120" height="120" />

# Skiller

**Declarative, human-in-the-loop workflow runner for VS Code.**

Write branching YAML playbooks that orchestrate your language model and MCP tools — with review and input steps — and run them from the status bar, the Command Palette, the editor, or Copilot chat.

[![VS Marketplace](https://img.shields.io/badge/VS%20Marketplace-tivaliy.skiller-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=tivaliy.skiller)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<img src="resources/demo.gif" alt="Skiller in action — a skill running with its live execution graph" width="900" />

### 📖 Full documentation → <https://tivaliy.github.io/skiller/>

</div>

---

## What is Skiller?

Skiller runs **skills** — declarative, multi-step workflows defined in YAML and Markdown. Each skill is a playbook: a sequence of steps that call a language model, invoke your [MCP](https://modelcontextprotocol.io) tools, and pause for your input or approval exactly where you tell them to.

It is deliberately **not** a free-form agent and **not** an "Agent Skills" auto-loader:

| | Free-form agent | **Skiller** |
| --- | --- | --- |
| Control flow | Model decides what to do next | **You** define the steps; the model fills them in |
| Side effects | Can act on its own | Runs **only** the steps you wrote, pausing for confirmation where you ask |
| Reproducibility | Varies run to run | Same playbook, same shape every time |
| Branching | Implicit | Explicit `confirmation` steps with `goto` jumps |

If you want predictable, reviewable automation that still leverages an LLM — not an autonomous agent — Skiller is for you. As a skill runs, you can watch it as a **live execution graph**, with branches and loops lighting up as they fire.

Skills run in VS Code itself, from the editor, and Copilot can run them too: it calls a skill as a tool, waits for the result, and carries on with its task. A workflow you write once works both ways.

## Requirements

- **VS Code 1.95+**
- A **trusted workspace**: in Restricted Mode, Skiller stays off, since skills call tools and write files
- A **language model provider** (e.g. GitHub Copilot, or any provider exposing VS Code's Language Model API)
- **MCP servers** configured in VS Code (optional — only needed for tool integrations)

## Quick start

### Install

**From the Marketplace:**

```text
ext install tivaliy.skiller
```

**From source:**

```bash
npm install
npm run package
code --install-extension skiller-*.vsix
```

### Run your first skill

- **The Skiller status bar item** (bottom right) opens your skills: pick one and **Run**. While a skill runs, it shows the skill's name; click it to bring the run's graph forward.
- **Skiller: Run Skill…** (Command Palette or editor context menu) — pick the built-in `greeter` to try it. Inputs are asked with pickers; confirmations, tool approvals, and the result appear as cards in the skill's live graph. The first run asks which model to use and remembers it (change it with the `skiller.model.default` setting).
- **Code actions** — the lightbulb menu offers **Skiller: Run ‹skill›** for skills that read your selection, file, or diagnostics.
- **Skiller: New Skill…** — describe a workflow and the built-in `skill-creator` drafts it, or start from a template or a copy. **Run it now** when it's written.
- **Copilot** — type `/skiller` in a Copilot chat, or just ask, and Copilot runs the matching skill (after you approve the run). This is unrelated to Copilot's own `/skills` commands.

Before a skill's step calls a tool, Skiller asks: **Allow**, **Allow for this run**, **Always allow in this workspace**, or **Deny** (**Skiller: Reset Tool Approvals** forgets the "always" choices).

Every run is also written to the **Skiller** output channel as it happens: the inputs, each step with its model, duration, and a one-line output, tool calls, your answers, and how the run ended. **Show log** on the result card opens it.

> **Upgrading from 0.4?** The `@skiller` chat participant and its slash commands are gone — see [where each command went](https://tivaliy.github.io/skiller/guides/running-skills/#coming-from-the-skiller-chat-commands).

See the [Getting Started tutorial](https://tivaliy.github.io/skiller/getting-started/introduction/) to install, run a skill, and author your own.

## Learn more

The docs are the single source of truth. Jump to what you need:

- **[Run a built-in skill](https://tivaliy.github.io/skiller/getting-started/run-a-bundled-skill/)** and **[Write your first skill](https://tivaliy.github.io/skiller/getting-started/write-your-first-skill/)** — guided tutorials.
- **[Running skills](https://tivaliy.github.io/skiller/guides/running-skills/)** and **[Use Skiller from Copilot](https://tivaliy.github.io/skiller/guides/use-from-copilot/)** — inputs, cards, tool approvals, the run log, and `/skiller`.
- **Guides** — how-to for [tool/MCP skills](https://tivaliy.github.io/skiller/guides/tool-mcp-skill/), [branching & looping](https://tivaliy.github.io/skiller/guides/branching-looping/), [debugging](https://tivaliy.github.io/skiller/guides/debugging/), and [models](https://tivaliy.github.io/skiller/guides/models/).
- **[Skills & discovery](https://tivaliy.github.io/skiller/concepts/skills-and-discovery/)**, **[Step types & state](https://tivaliy.github.io/skiller/concepts/step-types/)**, **[Templating with Liquid](https://tivaliy.github.io/skiller/concepts/templating/)**, and **[The execution graph](https://tivaliy.github.io/skiller/concepts/execution-graph/)** — how it all works.
- **[skill.yaml manifest](https://tivaliy.github.io/skiller/reference/skill-yaml/)** and **[step-file frontmatter](https://tivaliy.github.io/skiller/reference/step-frontmatter/)** — every field.
- **[Commands](https://tivaliy.github.io/skiller/reference/commands/)** — every Skiller command and Copilot tool.
- **[Settings](https://tivaliy.github.io/skiller/reference/settings/)** — every `skiller.*` setting and its default.
- **[Built-in tools](https://tivaliy.github.io/skiller/reference/built-in-tools/)** — `skiller_createFile`, `skiller_replaceInFile`, `skiller_writeSkill`, `skiller_listSkills`, and `skiller_runSkill`.

## Contributing

Issues and pull requests are welcome. See **[Contributing & development](https://tivaliy.github.io/skiller/contributing/)** for build, test, and PR guidelines, and for running the Extension Development Host.

## License

Licensed under the [MIT License](LICENSE).
