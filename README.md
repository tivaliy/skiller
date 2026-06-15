<div align="center">

<img src="resources/icon.png" alt="Skiller" width="120" height="120" />

# Skiller

**Declarative, human-in-the-loop workflow runner for VS Code chat.**

Write branching YAML playbooks that orchestrate your language model and MCP tools — with review and input steps — and run them from the `@skiller` chat participant.

[![VS Marketplace](https://img.shields.io/badge/VS%20Marketplace-tivaliy.skiller-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=tivaliy.skiller)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

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

If you want predictable, reviewable automation that still leverages an LLM — not an autonomous agent — Skiller is for you.

## Features

- 🧩 **Declarative skills** — author workflows as plain YAML + Liquid-templated Markdown, no code.
- ✋ **Human-in-the-loop** — `confirmation` steps pause for your choice and can branch or jump (`goto_step`).
- 🔧 **MCP tool orchestration** — call your configured MCP tools from `llm` and `tool` steps.
- 🗺️ **Live execution graph** — watch a skill run as a Mermaid state diagram in a side panel, with branches and `goto` loops lighting up as they fire.
- 📁 **Layered discovery** — workspace, user, and built-in skills, with workspace winning.
- 🧪 **Typed & validated** — manifests are schema-checked (Zod) with helpful errors before they run.

## Requirements

- **VS Code 1.93+**
- A **chat language model provider** (e.g. GitHub Copilot, or any provider exposing VS Code's Language Model API)
- **MCP servers** configured in VS Code (optional — only needed for tool integrations)

## Quick start

### Install

**From the Marketplace** (once published):

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

Open the Chat view and talk to `@skiller`:

```text
@skiller /help            Show available commands
@skiller /skills          List available skills
@skiller /skill greeter   Run the bundled "greeter" skill
```

A message that is **not** a slash command and **not** a skill gets a short hint — Skiller does not do free-form chat.

### Commands

| Command | Description |
| ------- | ----------- |
| `/help` | Show available commands |
| `/skills` | List discovered skills |
| `/skill <id>` | Run a skill |
| `/tools` | Show available MCP tools |
| `/models` | Show language models available for skill configuration |
| `/reload` | Reload tools and skills |

## Core concepts

A **skill** is a directory containing a `skill.yaml` manifest and one or more Liquid-templated step files. Skills are discovered from three sources, in precedence order (earlier wins):

1. **Workspace** — `.skiller/skills/` in your repo root
2. **User** — `~/.vscode/skiller/skills/`
3. **Built-in** — the `skills/` bundled with the extension

A skill with the same `id` in your workspace overrides the user copy, which overrides the built-in one — so you can fork and customize any bundled skill.

### Step types

| Type | What it does | Key fields |
| ---- | ------------ | ---------- |
| `llm` | Calls the model with a Liquid-templated prompt (optionally using MCP tools), stores the reply | `file`, `model`, `output` |
| `confirmation` | Pauses and shows a message with choices; can continue, abort, or jump | `message`, `options[].action` (`continue` / `abort` / `goto` + `goto_step`) |
| `tool` | Invokes one MCP tool directly with templated params | `tool` (alias), `params` |

## Authoring a skill

A skill is a folder with a `skill.yaml` manifest plus one Markdown prompt per `llm` step. The bundled **`mind-reader`** game is a good tour of the moving parts — run it with `@skiller /skill mind-reader`, then read how it's built below. Your own skills go under `.skiller/skills/<id>/`:

```yaml
# .skiller/skills/mind-reader/skill.yaml  (abridged — full source in the repo)
id: mind-reader
name: Mind Reader
description: Twenty Questions — think of anything and the model guesses it.
version: "1.0.0"

# Collected once before the skill runs. enum gives a hint; default lets the player just hit enter.
inputs:
  - name: category
    type: string
    required: false
    default: "anything"
    enum: ["anything", "an animal", "an object", "a famous person", "a place"]
    prompt: "Think of something and keep it secret. What kind of thing is it?"

models:
  default: gpt-4o

steps:
  # 1. Ask the next yes/no question. Steps share no memory, so the model carries
  #    what it knows forward in outputs.turn.notes (see the prompt file below).
  - id: ask
    type: llm
    file: steps/01-ask.md
    output: turn

  # 2. The player clicks an answer. Yes/No/Unsure loop BACK to `ask`; "guess now"
  #    branches to `guess`. The clicked label lands in outputs.reply.selectedOption.
  - id: answer
    type: confirmation
    message: "{{ outputs.turn.question }}"
    options:
      - { label: "Yes",                    action: goto, goto_step: ask }
      - { label: "No",                     action: goto, goto_step: ask }
      - { label: "Sometimes / Not sure",   action: goto, goto_step: ask }
      - { label: "I'm ready — guess now!", action: goto, goto_step: guess }
    output: reply

  # 3. Commit to a guess from the notes.
  - id: guess
    type: llm
    file: steps/02-guess.md
    output: final

  # 4. Right? "Nope" loops back to keep asking; "Stop" ends it.
  - id: verdict
    type: confirmation
    message: "My guess: **{{ outputs.final.guess }}** — did I get it?"
    options:
      - { label: "Yes! 🎉",            action: continue }
      - { label: "Nope — keep asking", action: goto, goto_step: ask }
      - { label: "Stop here",          action: abort }
    output: result

on_error: abort

output:
  summary: "🔮 Run `/skill mind-reader` again to play more."
```

The `goto` options are what make it a *game*: three of `answer`'s buttons jump back to `ask` (a loop), one jumps forward to `guess` (a branch) — that looping/branching is exactly what the [live graph](#features) animates. Because steps don't share conversation history, the model threads its progress through `outputs` — a running `notes` blob it rewrites each turn.

Each `llm` step runs a Markdown + [Liquid](https://liquidjs.com/) prompt with access to `{{ inputs.* }}` and `{{ outputs.* }}`. Here's `steps/01-ask.md` (abridged):

```markdown
---
id: ask
---
You're playing Twenty Questions; the player is thinking of {{ inputs.category }}.

{% if outputs.turn %}
What you know so far:
{{ outputs.turn.notes }}
The player's answer to "{{ outputs.turn.question }}" was: {{ outputs.reply.selectedOption }}
{% else %}
This is your first question — start broad.
{% endif %}

Reply with ONLY JSON: { "notes": "...updated facts...", "question": "your next yes/no question" }
```

`{% if outputs.turn %}` guards the first turn, when no prior output exists yet — Liquid's `lenientIf` treats the undefined value as falsy instead of erroring.

**Tool steps write files.** `mind-reader` stays in chat, but to produce a file add a `tool` step backed by a built-in tool:

```yaml
tools:
  aliases:
    create_file: skiller_createFile
steps:
  - id: save
    type: tool
    tool: create_file
    params:
      filePath: "notes.md"
      content: "{{ outputs.turn.notes }}"
```

### Bundled examples

Two working skills ship with the extension:

- **`greeter`** — a tiny `llm` + `confirmation` flow with an `abort` branch. The "hello world" of skills.
- **`mind-reader`** — a game of Twenty Questions: think of anything and the model guesses it through yes/no questions. Its `goto` loops and branches make the [live execution graph](#features) come alive, and it stays entirely in chat (writes nothing to your workspace).

Run either with `@skiller /skill <id>`. `greeter` is the simplest starting point; the `mind-reader` walkthrough above shows the full surface — typed input, looping `goto` branches, and human-in-the-loop review.

## Built-in tools

Skiller registers two language-model tools that work reliably in skill `tool` steps and in chat:

- **`skiller_createFile`** — create a file at a path with given content.
- **`skiller_replaceInFile`** — replace an exact substring within an existing file.

## Settings

| Setting | Default | Description |
| ------- | ------- | ----------- |
| `skiller.skills.verboseMode` | `"off"` | Debug output: `"off"`, `"rendered"`, or `"raw"` |
| `skiller.skills.toolInvocationTimeout` | `60000` | MCP tool timeout (ms) |
| `skiller.skills.maxToolIterations` | `10` | Max tool calls per skill step |
| `skiller.llm.maxHistoryTurns` | `20` | Conversation turns sent to the LLM |
| `skiller.llm.maxToolResponseLength` | `4000` | Tool response truncation limit (chars) |
| `skiller.llm.maxToolResponses` | `10` | Tool responses kept in follow-up context |

## Development

```bash
npm install
npm run compile      # dev build (esbuild)
npm run watch        # rebuild on change
npm run typecheck       # tsc --noEmit (src)
npm run typecheck:test  # tsc --noEmit (src + tests)
npm run test            # unit tests (vitest)
npm run package         # build a .vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with Skiller loaded.

## Contributing

Issues and pull requests are welcome. Please:

1. Run `npm run typecheck:test` and `npm run test` before opening a PR.
2. Keep changes focused and add tests for new behavior.
3. Follow the existing code style and patterns.

## License

Licensed under the [MIT License](LICENSE).
