---
title: Run a bundled skill
description: Talk to the @skiller chat participant and run one of the skills that ship with Skiller.
sidebar:
  order: 3
---

Open the Chat view and talk to `@skiller`:

```text
@skiller /skills          List available skills
@skiller /skill greeter   Run the bundled "greeter" skill
```

`greeter` asks for your name, generates a greeting, then **pauses** to ask whether you'd also like a
fun fact. That pause is a `confirmation` step — Skiller's human-in-the-loop core. Click an option to
continue.

> Want to see the live execution graph branch and loop? Run `@skiller /skill mind-reader` — a game
> of Twenty Questions whose `goto` loops light up the graph as you play.

A message that is **not** a slash command and **not** a skill gets a short hint — Skiller does not
do free-form chat.

## Commands

| Command | Description |
| ------- | ----------- |
| `/help` | Show available commands |
| `/skills` | List discovered skills |
| `/skill <id>` | Run a skill (e.g. `/skill greeter`) |
| `/tools` | Show available MCP tools |
| `/models` | Show language models available for skill configuration |
| `/reload` | Reload tools and skills (after editing a `skill.yaml`) |
| `/status` | Show whether a skill is awaiting input or confirmation |
| `/cancel` | Cancel the skill awaiting input or confirmation |
| `/reset` | Clear all Skiller state |

Ready to build your own? [Write your first skill →](../write-your-first-skill/)
