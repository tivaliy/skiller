---
title: Settings
description: Every skiller.* setting, its default, and when to change it.
sidebar:
  order: 4
---

Skiller contributes seven settings under the `skiller.*` namespace. Set them in your
User or Workspace `settings.json`, or through the Settings UI (search for "Skiller").

| Setting | Default | Effect / when to change |
| ------- | ------- | ----------------------- |
| `skiller.model.default` | `""` | Fallback model id for steps whose skill names no model. Empty: you're asked once and your pick is remembered. |
| `skiller.skills.toolInvocationTimeout` | `60000` | Milliseconds before a tool invocation in a step times out. Raise for slow MCP servers. |
| `skiller.skills.maxToolIterations` | `10` | Maximum tool-use iterations per `llm` step. Caps runaway agentic loops. |
| `skiller.skills.allowOutsideWorkspaceWrites` | `false` | Lets the built-in file tools write outside the workspace. A security control — leave off unless required. |
| `skiller.llm.maxHistoryTurns` | `20` | Maximum conversation turns sent to the model as context. Higher = more context, more tokens. |
| `skiller.llm.maxToolResponseLength` | `4000` | Maximum characters per tool response before truncation (≈ 1000 tokens at 4000). |
| `skiller.llm.maxToolResponses` | `10` | Maximum tool responses carried into follow-up context. |

## `skiller.model.default`

The model id native runs fall back to for steps whose skill names no model (no step `model`, no
`models.default`) or names one you don't have. Leave it empty and the first run asks **Choose a
model for Skiller runs**, then remembers your pick; set it to make the choice explicit or to change
it later. An id that isn't installed is ignored. See
[Use & override models](../../guides/models/#the-fallback-model).

## `skiller.skills.allowOutsideWorkspaceWrites`

:::caution[Security control]
The built-in file tools (`skiller_createFile`, `skiller_replaceInFile`) are confined to
the workspace folder. When this setting is `false` (the default), any target path that
resolves outside the workspace is refused.

Enable it only when a skill legitimately needs to write to absolute paths beyond the
workspace, and prefer scoping it to a trusted Workspace `settings.json` rather than your
User settings.
:::

See [Built-in tools](../built-in-tools/) for what the file tools do and how confinement
is enforced.

## Agentic-loop knobs

When an `llm` step is allowed to call tools, Skiller runs an agentic loop: the model
calls a tool, reads the result, and decides whether to call another. These settings bound
that loop and the token cost it accrues.

| Setting | Bounds | Trade-off |
| ------- | ------ | --------- |
| `skiller.skills.maxToolIterations` | How many tool calls a single step may make before the loop is force-stopped. | More iterations let the model chase a multi-step task, but a stuck model can burn the whole budget. |
| `skiller.skills.toolInvocationTimeout` | How long one tool call may run before it is aborted. | Raise for slow MCP servers; lower to fail fast on unresponsive tools. |
| `skiller.llm.maxHistoryTurns` | How many prior turns are replayed as context. | More turns improve continuity within a step but grow the prompt — and the token bill — every iteration. |
| `skiller.llm.maxToolResponseLength` | Characters kept per tool response before truncation. | Larger keeps more of a big result in context; smaller trims noise and saves tokens. |
| `skiller.llm.maxToolResponses` | How many tool responses are carried into the follow-up prompt. | More responses help the model correlate earlier results; fewer keep the context lean. |

The five knobs interact: each extra iteration can add another tool response, and each
response can add up to `maxToolResponseLength` characters across up to `maxHistoryTurns`
of replayed context. If steps feel slow or expensive, tighten `maxToolIterations` and
`maxToolResponseLength` first.

## See also

- [Commands](../commands/) — every Skiller command.
- [Built-in tools](../built-in-tools/) — the workspace-confined file tools.
- [Debug a skill](../../guides/debugging/) — hover inspection in practice.
