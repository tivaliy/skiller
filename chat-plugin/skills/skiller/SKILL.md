---
name: skiller
description: Run the user's Skiller workflows (reviewable, step-by-step playbooks) from chat. Use when the user asks to run or list their Skiller skills or workflows, or wants a repeatable, reviewed procedure run.
---

# Skiller workflows

Skiller workflows are declarative skills defined in the user's VS Code (workspace, user or built-in). You run them with two tools. This is unrelated to Copilot's own `/skills` commands (add, info, list, reload, remove), which manage agent skills, not Skiller workflows.

## Steps

1. Call `skiller_listSkills` (no input). It returns a JSON array; each entry has `id`, `name`, `description`, `inputs` (`name`, `type`, `description`, `required`, `editorBound`) and `writesToEditor`.
2. Pick the workflow whose description matches the request. If none fits or several are plausible, tell the user and ask; do not guess.
3. Call `skiller_runSkill` with `id` and, in `inputs`, the values the user gave, keyed by input name. Do not invent values. Omit inputs that are `editorBound` (they are filled from the active editor) and any the user did not provide; VS Code asks the user for missing required inputs itself.
4. The user is asked to approve the run, and the run may ask for their input or confirmation in VS Code. It can take minutes.

## Reporting the result

The tool's result is not shown to the user automatically. Always tell the user what happened:

- On success, report the result summary in your reply, including any note about where the output was delivered.
- If the result starts with "The skill failed:", report the failure and its reason.
- If the result is "The run continues in VS Code; see the graph panel for the result.", tell the user the run is still going and that the result will appear in the Skiller graph panel in VS Code.
- If the run was cancelled, was not started, or the id is unknown (the result lists the valid ids), say so and offer a next step.
