---
title: Branch & loop with confirmations
description: Use goto jumps to branch and loop, threading state through outputs.
sidebar:
  order: 2
---

Steps normally run top to bottom. To make a skill **loop** — repeat a step until the user is
done — or **branch** — jump ahead to a different step — you give a `confirmation` step
options whose `action` is `goto`. This guide builds the pattern up from the built-in
`mind-reader` example, a Twenty Questions game whose loops and branches light up the
[live execution graph](../../concepts/execution-graph/) as they fire.

## How `goto` works

A `confirmation` step shows the user a set of `options`. Each option carries an `action`:

| `action` | What happens |
| -------- | ------------ |
| `continue` | Fall through to the next step in order |
| `abort` | End the skill |
| `goto` | Jump to the step named in `goto_step` |

`goto` is the whole story. Where you point `goto_step` decides whether you loop or branch:

- **Backward `goto`** (to a step that already ran) creates a **loop** — the skill runs that
  step again.
- **Forward `goto`** (to a step further down) creates a **branch** — the skill skips ahead.

Here is the answer step from `mind-reader`. Two options loop back to the question step;
one branches forward to the guess step.

```yaml
- id: answer
  type: confirmation
  message: "{{ outputs.turn.question }}"
  options:
    - { label: "Yes",                    action: goto, goto_step: ask }   # loop back
    - { label: "No",                     action: goto, goto_step: ask }
    - { label: "I'm ready — guess now!", action: goto, goto_step: guess } # branch forward
  output: reply
```

The label the user picks is recorded in this step's output. Read it back from the target step
as `{{ outputs.reply.selectedOption }}` (the full object is
`{ selectedOption, selectedIndex, action, timestamp }` — see the
[skill.yaml reference](../../reference/skill-yaml/)).

:::note
`goto_step` must name a real step `id` in the same skill. It is a `goto` jump, not a function
call — there is no return. After the target step runs, execution simply continues from there
in order until the next `goto`, `continue`, `abort`, or the end of the skill.
:::

## Threading state through a loop

Looping introduces a problem you have to design around: **steps share no conversation
history.** Each `llm` step is a fresh call to the model with only its rendered prompt. The
*only* data channel between steps is `outputs.<name>` (see
[Step types & state](../../concepts/step-types/)). So when the `ask` step runs for the tenth
time, the model has no memory of the previous nine turns unless you hand that memory back to
it.

The fix is a **loop-carried accumulator**: the model writes everything it knows into one of
its own output fields, and the prompt feeds that field back in on the next pass. In
`mind-reader` this is the running `notes` blob. The `ask` step returns JSON with two
fields — the `notes` it carries forward and the `question` it wants to ask:

```json
{
  "notes": "A short bullet list of everything you now know. Carry ALL prior facts forward and append what the latest answer told you.",
  "question": "Your next yes/no question."
}
```

Because the reply is valid JSON, Skiller auto-parses it, so later passes can read
`{{ outputs.turn.notes }}` and `{{ outputs.turn.question }}` as fields. The prompt file then
re-injects the accumulator and the user's last answer at the top of every turn, guarded so
the very first turn (when `outputs.turn` is still undefined) starts clean:

```liquid
{% if outputs.turn %}
Here is everything you have learned so far (your running notes):

{{ outputs.turn.notes }}

Your previous question was: "{{ outputs.turn.question }}"
The player answered: **{{ outputs.reply.selectedOption }}**
{% else %}
This is your very first question — you know nothing yet, so start broad.
{% endif %}
```

The loop now sustains itself:

1. `ask` reads `outputs.turn.notes` (its own output from the previous pass) and
   `outputs.reply.selectedOption` (the user's last answer), folds the answer into the notes,
   and writes a fresh `notes` + `question` back to `outputs.turn`.
2. `answer` shows the question and loops back to `ask` — or branches forward to `guess`.
3. On the next pass, `ask` reads the *updated* `outputs.turn.notes`, and so on.

Each pass **overwrites** `outputs.turn`, so the accumulator is only as complete as the model
makes it. That is why the prompt explicitly instructs the model to *carry all prior facts
forward* — if it drops a fact from `notes`, that fact is gone. Treat the accumulator field as
your hand-rolled memory and be explicit in the prompt about preserving it.

:::caution[The first-turn guard is required]
On the first pass `outputs.turn` does not exist yet. In a prompt, referencing an undefined
variable's *field* (`outputs.turn.notes`) throws, because templating is strict in prompts.
Guard the whole block with `{% if outputs.turn %}…{% endif %}` — an undefined top-level
variable is treated as falsy, so the guard is safe. See
[Templating with Liquid](../../concepts/templating/) for the strict-vs-permissive rules.
:::

## Branching forward, then looping again

Branches and loops compose. After the user picks *"guess now!"*, `mind-reader` jumps to the
`guess` step, then a second `confirmation` decides what happens next — accept the guess and
finish, or loop *all the way back* to `ask` to keep narrowing down:

```yaml
- id: verdict
  type: confirmation
  message: "I think you're thinking of… **{{ outputs.final.guess }}**. Did I get it?"
  options:
    - { label: "Yes! 🎉 You got it",   action: continue }   # finish
    - { label: "Nope — keep asking",  action: goto, goto_step: ask }  # loop back
    - { label: "Stop here",           action: abort }
  output: result
```

The `guess` prompt, in turn, reads `outputs.final` on a *previous* failed guess to avoid
repeating itself — the same accumulator technique, applied to a second output. Any output any
step has produced is fair game as loop-carried state; the only rule is that a step can read it
only after it has been written.

## Watch it run

Run `@skiller /skill mind-reader` and open the live execution graph. The `goto` edges are
drawn explicitly and labeled, so each loop back to `ask` and each forward branch to `guess`
animates the moment it fires — the marching-ants edge traces the exact path the run took.
Because the graph is the literal control flow, it is the fastest way to confirm a `goto`
points where you intended. See [The execution graph](../../concepts/execution-graph/) for
what every state and edge means.

## Recap

- Branch and loop with `confirmation` options whose `action` is `goto` and a `goto_step`
  pointing at a step `id`. Backward = loop, forward = branch.
- Steps share no history, so carry loop state forward yourself in an `outputs` field, feed it
  back through the prompt, and instruct the model to preserve it on every pass.
- Guard the first turn with `{% if outputs.<name> %}` because the accumulator does not exist
  before its first write.

## Related

- [Step types & state](../../concepts/step-types/) — why steps share no history and how
  `outputs` is the only channel.
- [The execution graph](../../concepts/execution-graph/) — how loops and branches are drawn
  and animated.
- [skill.yaml manifest](../../reference/skill-yaml/) — the full `confirmation` and `goto`
  schema.
