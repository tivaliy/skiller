---
title: Run a built-in skill
description: Run one of the built-in example skills that ship with Skiller, straight from the Command Palette.
sidebar:
  order: 3
---

Skiller ships with built-in skills — this walkthrough uses `greeter` and `mind-reader` (a third, `skill-creator`, [writes new skills for you](../create-a-skill/)) — so you can run a
real workflow before writing one. This walkthrough has you find them, run each, and watch the
[live execution graph](../../concepts/execution-graph/) react as the steps fire.

## 1. See the available skills

Open the Command Palette and run **Skiller: Show Skills**. You'll see `greeter`, `mind-reader`, and
`skill-creator` (plus any skills you've added in your workspace or user folder). Pick one to
**Run** it, **Show Graph**, or — for a built-in — **Copy to Workspace…**.

The list updates by itself when skill files change on disk. **Skiller: Reload Skills** re-scans on
demand and reports what changed.

## 2. Run `greeter` — meet the confirmation pause

Run **Skiller: Run Skill…** and pick **Greeter**.

The first time you run a skill, Skiller may ask **Choose a model for Skiller runs**. Pick one; it is
remembered (or set [`skiller.model.default`](../../reference/settings/#skillermodeldefault)).

`greeter` asks for your name, generates a personalized greeting, then **pauses** and asks whether
you'd also like a fun fact. That pause is a `confirmation` step — Skiller's human-in-the-loop core.
The skill's graph opens beside your editor with the question as a card; nothing happens until you
click an option:

- **Yes, give me a fun fact** continues to the next step.
- **No thanks, just the greeting** stops the run there.

When it finishes, the result appears as a card in the graph, with **Open as document** and **Copy**.

## 3. Run `mind-reader` — watch the graph branch and loop

Open the graph first so you can watch from the first step: **Skiller: Show Skills** → **Mind
Reader** → **Show Graph**. Then run it (**Skiller: Run Skill…** → **Mind Reader**).

`mind-reader` is a game of Twenty Questions: think of something, and the model asks yes/no questions
until it guesses. Each answer you click either **loops back** to ask another question or **branches
forward** to the guess — control flow driven by `goto` confirmation options.

Play a few rounds. Watch the active step highlight, the traversed edge animate, and the loop edge
light up each time you send the model back to ask again. This branching and looping is the surface
the graph is built to make visible.

## Other ways to run

The same skills run from the editor context menu (**Run Skill…**), from code actions for skills that
read your selection, and from Copilot chat with `/skiller`. See
[Running skills](../../guides/running-skills/) and the [Commands reference](../../reference/commands/).

---

Ready to build your own? [Create a skill →](../create-a-skill/) — describe it, start from a template, or copy one of these.
