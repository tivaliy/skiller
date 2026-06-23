Produce a short **Markdown document** that maps the change below as a diagram a reviewer can read at a glance.

Include, in this order:

1. A one-line summary of what the change reshaped.
2. A Mermaid flowchart inside a fenced ` ```mermaid ` block: each module/layer is a node, dependency relationships are arrows (`-->`), and the boundaries this change crosses are highlighted — use a thicker `==>` link, or mark the affected nodes with a class:
   `classDef changed stroke:#d33,stroke-width:3px;`
3. A short legend: one line per highlighted boundary, naming what changed.

Scope:
{{ outputs.scope }}
{% if outputs.focus %}
Give this boundary extra prominence in the graph:
{{ outputs.focus }}
{% endif %}
{% if outputs.map %}
You already drew the map below. Keep it and add ONE more layer of detail — expand a node into its sub-modules, or surface an edge you omitted. Do not start over.

{{ outputs.map }}
{% endif %}

Output format — read carefully:
- Output the Markdown document ONLY, starting with the summary line.
- The Mermaid diagram MUST be inside a ` ```mermaid ` fenced block so it renders in the preview.
- Do NOT wrap your ENTIRE reply in a single code fence — only the diagram is fenced. A whole-reply fence would be stripped and the map would not render.
