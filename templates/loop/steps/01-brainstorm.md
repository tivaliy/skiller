---
id: brainstorm
description: Propose a few ideas
---
Suggest three fresh ideas about: {{ inputs.subject }}.
{% if outputs.ideas %}
You already suggested these, so do not repeat them:

{{ outputs.ideas }}
{% endif %}
