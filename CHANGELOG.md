# Changelog

All notable changes to the **Skiller** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Skills now run natively in VS Code, and Copilot can run them for you. The `@skiller` chat participant is gone.

### Added

- **Native runs.** Skills run in VS Code itself, from `Skiller: Run Skill…`, the editor context menu, code actions, and `Run it now` after creating a skill. Inputs are asked with input boxes and pick lists; a progress notification shows the current step and has a **Cancel** button.
- **Interactive cards in the graph panel.** Confirmations, tool approvals, and the finished result appear as cards in the skill's live execution graph, which opens when a run needs you. If the panel can't be shown, or is closed while a card waits, confirmations and tool approvals fall back to a modal dialog that shows the full message.
- **Tool approvals.** VS Code asks for no approval before a tool runs outside chat, so Skiller asks before a tool runs: **Allow** (this call), **Allow for this run**, **Always allow in this workspace**, or **Deny**. Skiller's own tools use their own wording (**Create File**, **Replace in File**, **Write Skiller skill**) with a preview.
- **Copilot can run your skills.** A chat plugin adds `/skiller` to Copilot chats, backed by two new language-model tools: `skiller_listSkills` lists the runnable skills and their inputs, and `skiller_runSkill` runs one by id. `skiller_runSkill` always asks before it starts, waits up to 10 minutes for the result, then returns while the run continues in VS Code. Both are for agents outside a run: a skill that references either fails its readiness check, and a step that offers one anyway (for example through step-file frontmatter) fails when it runs. Unrelated to Copilot's own `/skills` commands.
- **Create skills without a blank file:** `Skiller: New Skill…` offers **Describe it** (runs the new built-in `skill-creator` skill natively: it drafts a plan, lets you revise it, then writes the skill), **From a template**, or **Copy a skill**. New skills are validated before they are written to `.skiller/skills/<id>/`.
- Five starter templates (`basic`, `approval`, `loop`, `tool`, `editor`) and three copyable examples (`change-map`, `shell-it`, `smell-refactor`); built-in skills can be forked into the workspace with **Copy to Workspace…** in `Skiller: Show Skills`.
- A **Skiller** status bar item: it opens `Skiller: Show Skills`, and while a skill runs it shows the skill's name and brings the run's graph forward when clicked. Hide it from the status bar's context menu.
- New commands: `Skiller: Show Skills` (run a skill, show its graph, or copy a built-in), `Skiller: Cancel Run`, `Skiller: Reload Skills`, and `Skiller: Reset Tool Approvals`.
- The `skiller.model.default` setting: the fallback model id for steps whose skill names no model. When it is empty, the first run asks for a model once and remembers it; pressing Escape on that picker cancels the run.
- The `from: tools` input binding, which fills an input with the installed language-model tools.
- The `skiller_writeSkill` language-model tool, which writes a validated skill folder atomically. It asks for confirmation unless it is called from Skiller's own `skill-creator` run. Among skills, only built-in skills may use it: a workspace or user skill that references it fails its readiness check, and a step that offers or calls it anyway (for example through step-file frontmatter) fails when it runs.
- A one-time notice for users upgrading from 0.4, pointing at `Skiller: Run Skill…` and Copilot.
- The **Skiller** output channel logs which model each AI step runs on and why: the step's model, the skill's `models.default`, or your model for Skiller runs.

### Changed

- Every entry point — the Command Palette, the editor context menu, code actions, `Run it now`, and Copilot — runs the skill natively instead of handing it to chat.
- Steps that name no model, or a model that isn't available, use the fallback model above (previously the chat session's model).
- Skiller now activates once VS Code has started (`onStartupFinished`) instead of only in workspaces that contain skills, so the status bar item is there before you have any.
- In Restricted Mode, VS Code now says why Skiller is off: it needs a trusted workspace, since skills call tools and write files.

### Removed

- The `@skiller` chat participant and all its slash commands (`/skill`, `/new`, `/skills`, `/help`, `/tools`, `/models`, `/reload`, `/cancel`, `/reset`, `/status`). See the docs' [Running skills](https://tivaliy.github.io/skiller/guides/running-skills/#coming-from-the-skiller-chat-commands) page for where each one went.
- The `skiller.skills.runSurface` setting: every entry point now runs the skill directly.
- The `skiller.skills.verboseMode` setting. It printed each step's prompt and response into the `@skiller` chat; to see what a step sent and received, hover it in the live execution graph (**Open ↗** shows both in a read-only document).
- The chat model-dropdown override of a skill's models, and the graph's model-override banner.

### Fixed

- Skiller never activated on VS Code 1.93: the language-model tools API it uses was still proposed there. The minimum VS Code version is now 1.95.
- A skill that references a tool that only works inside a VS Code chat session (Copilot's `copilot_createFile` / `copilot_editFiles`, subagents, and interactive prompts) now fails its readiness check, pointing at Skiller's file tools where they apply, instead of failing mid-run. A step that offers one anyway (for example through step-file frontmatter) fails with the same message when it runs.
- An editor write-back skill (`editor.replaceSelection`, `editor.insert`, `diff`) no longer writes into its own `skill.yaml` or step files when one of them is the active editor at launch — for example right after creating the skill, when its `skill.yaml` is open. The result opens in a new tab instead.
- When an editor write-back sink falls back to a new tab (no launch editor, or the document changed since launch), Skiller now says so instead of reporting an in-place write.
- The bundled `greeter` example no longer pins `gpt-4o` and `gpt-4.1`. Its first step failed for users whose plan no longer serves `gpt-4o`, even though VS Code still lists it. It now runs on the model you choose for Skiller runs.
- A failed model request now names the model and the step (`Model 'gpt-4o-2024-11-20' failed in step 'greet': …`) and shows the provider's message instead of its raw JSON.
- When a card opened the graph panel, Skiller also showed a **Skiller is waiting for you** notification that stayed after you answered. It now shows only if the panel is still out of sight after opening and the card is still unanswered.

## [0.4.0] - 2026-06-23

### Added

- Inputs can bind to editor context with `from:` (`selection`, `activeFile[.path|.content|.language]`, `git.staged`, `git.working`, `diagnostics`); bound inputs are pre-filled at launch instead of prompted, falling back to prompting when the context is empty.
- Run skills from the editor: a "Skiller: Run Skill…" command (Command Palette, editor context menu) and contextual "Run <skill>" code actions for skills whose `from:` inputs match the current selection/file/diagnostics. Editor context is captured at trigger time. The `skiller.skills.runSurface` setting chooses prefill-and-launch (`adaptive`, default) vs run-and-watch (`chat`).
- Deliver a completed skill's output back to the workspace with `output.to:` — `newDocument`, `file:<path>` (workspace-guarded), `editor.replaceSelection`, `editor.insert`, `diff` (preview the result against the launch document and apply on accept), `terminal` (type a command without running it), or `terminal.run` (type and run it — pair with a confirmation step). Omitting `to:` keeps the existing chat-only behavior.

## [0.3.0] - 2026-06-20

### Added

- **Hover inspection in the execution graph.** Hovering an executed `llm` or `confirmation` node reveals its fully-interpolated prompt and the model's response, with the model, duration, tools used, and status. "Open ↗" opens the captured prompt/response as a read-only document that refreshes in place when a step re-runs (so loops show their latest iteration), and "Copy" copies the prompt. Captured data is session-scoped and cleared on reset.

## [0.2.0] - 2026-06-19

### Changed

- The live execution graph is now drawn with the ELK layout engine and a hand-rolled SVG renderer, replacing the Mermaid state diagram. Dense, looping skills stay readable: orthogonal edge routing, node cards that arrows dock flush to, and legible loop-backs. During a run the active, awaiting-input, and error steps pulse, completed steps are checkmarked, and validation warnings and errors show inline.

### Removed

- The Mermaid renderer and the `mermaid` dependency; the graph webview now ships a smaller bundle (only the ELK and pan/zoom libraries).

## [0.1.1] - 2026-06-17

### Fixed

- Skills with backward `goto` loops now carry state forward across iterations. On resume, the executor no longer deletes a re-running step's own output before it re-renders, so loop-carried values persist (each step still overwrites its output when it runs). This fixes the bundled `mind-reader` game, which previously lost its running notes every turn and asked the same question indefinitely.

## [0.1.0] - 2026-06-17

Initial release.

### Added

- `@skiller` chat participant for running declarative workflows ("skills").
- Skill manifest format (`skill.yaml`) with `llm`, `confirmation`, and `tool` step types.
- Liquid templating in step prompts with access to `{{ inputs.* }}` and `{{ outputs.* }}`.
- Human-in-the-loop `confirmation` steps with `continue` / `abort` / `goto` branching.
- MCP tool orchestration from `llm` and `tool` steps, with tool aliases.
- Layered skill discovery: workspace `.skiller/skills/`, user `~/.vscode/skiller/skills/`, and bundled built-ins (workspace wins).
- Live execution graph rendered as a Mermaid state diagram.
- Schema validation (Zod) of skill manifests with actionable error messages.
- Built-in tools `skiller_createFile` and `skiller_replaceInFile`.
- Commands: `/help`, `/skills`, `/skill`, `/tools`, `/models`, `/reload`.
- Two bundled example skills: `greeter`, `mind-reader`.

[0.4.0]: https://github.com/tivaliy/skiller/releases/tag/v0.4.0
[0.3.0]: https://github.com/tivaliy/skiller/releases/tag/v0.3.0
[0.2.0]: https://github.com/tivaliy/skiller/releases/tag/v0.2.0
[0.1.1]: https://github.com/tivaliy/skiller/releases/tag/v0.1.1
[0.1.0]: https://github.com/tivaliy/skiller/releases/tag/v0.1.0
