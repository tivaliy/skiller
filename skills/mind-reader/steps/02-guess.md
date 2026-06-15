---
id: guess
description: Make a guess
---

You are playing **Twenty Questions** and it is time to commit to your best guess about what the player is thinking of ({{ inputs.category }}).

Everything you have learned:

{{ outputs.turn.notes }}

{% if outputs.final %}
You previously guessed **"{{ outputs.final.guess }}"** and it was wrong — do not repeat it.
{% endif %}

Make your single most likely guess. Be specific and confident — name one concrete thing, not a category.

Respond with **only** a JSON object — no prose, no code fences:

{
  "guess": "your specific guess",
  "why": "one short sentence pointing to the clues that led you here"
}
