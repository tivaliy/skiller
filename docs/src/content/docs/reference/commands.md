---
title: Commands
description: Every @skiller slash command, its arguments, and what it does.
sidebar:
  order: 3
---

Skiller adds a single chat participant, `@skiller`, that runs declarative workflows.
You drive it with slash commands: address `@skiller`, then type a command. A message that
is neither a slash command nor a skill launch gets a short hint pointing you back to the
commands below — `@skiller` does not do free-form chat.

## All commands

| Command | What it does | Notes |
| ------- | ------------ | ----- |
| `/help` | Lists the available commands. | Start here if you forget a command. |
| `/skills` | Lists every discovered skill with its `id`, name, and source tier. | Source is workspace, user, or built-in. |
| `/skill <id> [params]` | Runs the skill with that `id`. | Accepts named (`name=Ada`) and positional launch arguments — see below. |
| `/tools` | Lists the tools available to skills. | Includes the built-in file tools and any configured MCP tools. |
| `/models` | Lists the language models available for skill configuration. | The ids you reference in `models.default` / `models.aliases`. |
| `/reload` | Re-scans skills and tools and reports what changed. | Shows an added / removed / parse-error diff (see below). |
| `/status` | Reports whether a skill is awaiting input or confirmation. | Control command — works mid-skill. |
| `/cancel` | Aborts the skill currently awaiting input or confirmation. | Control command — works mid-skill. |
| `/reset` | Clears all Skiller state — pending interactions and graph highlights. | Control command — the blunt recovery hatch. |

## Launching a skill: `/skill <id> [params]`

`/skill <id>` runs a discovered skill. Any input the skill declares but you do not supply on
the command line is collected interactively before the skill starts.

You can pass launch arguments two ways, and mix them:

- **Named** — `name=value`. Matches the input by its declared `name`.
- **Positional** — a bare value. Fills the remaining inputs in declaration order.

```text
@skiller /skill greeter name=Ada
@skiller /skill greeter "Ada"
```

Both forms set the `name` input to `Ada`. Quote a value that contains spaces.

## The `/reload` diff

`/reload` re-scans all three discovery tiers and the configured tools, then prints what
changed rather than a flat list:

- **Added** — skills or tools that now exist.
- **Removed** — skills or tools that disappeared (their graph highlights are cleared; a
  pending interaction tied to a removed skill is dropped).
- **Parse errors** — skills whose `skill.yaml` now fails validation (and any that were
  previously broken and are now fixed).

Use it after editing a manifest on disk so the registry and any open
[live execution graph](../../concepts/execution-graph/) panels pick up the change.

## Control commands work mid-skill

`/status`, `/cancel`, and `/reset` are **control commands**. They are dispatched *before* the
pending-interaction gate, so they always run — even while a skill is paused waiting for input
or a confirmation. Without this, a wedged pending state could block its own escape hatch.

- `/status` — tells you whether something is paused, and at which step.
- `/cancel` — aborts only the skill awaiting input or confirmation.
- `/reset` — clears everything, when state is thoroughly stuck.

Pending state is isolated per conversation: a skill paused in one chat will not consume a turn
you send in a different chat. Use `/cancel` or `/reset` from the chat that started the skill.

## No free-form chat

Skiller is skills-only by design. A message to `@skiller` that is not a recognized command and
does not launch a skill returns a short hint listing `/skills`, `/skill <name>`, and `/help` —
it does not attempt an open-ended conversation.

## Next

- [Run a built-in skill](../../getting-started/run-a-bundled-skill/) — try `/skills` and
  `/skill greeter` end to end.
- [Settings](../../reference/settings/) — tune verbose output and the agentic-loop limits.
