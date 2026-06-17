# Changelog

All notable changes to the **Skiller** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.1]: https://github.com/tivaliy/skiller/releases/tag/v0.1.1
[0.1.0]: https://github.com/tivaliy/skiller/releases/tag/v0.1.0
