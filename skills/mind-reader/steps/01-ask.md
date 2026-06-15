---
id: ask
description: Ask the next yes/no question
---

You are playing **Twenty Questions**. The player has secretly thought of {{ inputs.category }}, and your job is to figure out exactly what it is by asking sharp yes/no questions — one at a time — that split the remaining possibilities roughly in half.

{% if outputs.turn %}
Here is everything you have learned so far (your running notes — treat these as the source of truth):

{{ outputs.turn.notes }}

Your previous question was: "{{ outputs.turn.question }}"
The player answered: **{{ outputs.reply.selectedOption }}**
{% else %}
This is your very first question — you know nothing yet, so start broad.
{% endif %}

{% if outputs.final %}
Note: you already guessed **"{{ outputs.final.guess }}"** and it was WRONG. Rule it out and explore a different angle.
{% endif %}

Choose the single best next yes/no question. First fold the player's latest answer into your notes, then pick the question that most efficiently narrows things down.

Respond with **only** a JSON object — no prose, no code fences:

{
  "notes": "A short bullet list (one fact per line) of everything you now know. Carry ALL prior facts forward and append what the latest answer told you.",
  "question": "Your next question, phrased so that Yes / No / Not sure are all sensible answers."
}
