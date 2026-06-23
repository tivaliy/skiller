From the change scope below, pick the SINGLE most significant boundary the diff crosses — the one a reviewer most needs to understand.

For that boundary, detail:
- the two sides (modules/layers) and the direction of the dependency,
- whether the change adds, removes, or reshapes the edge,
- any inverted or backwards edge (a lower or shared layer depending on a higher or leaf one), since those are the riskiest.

A few sentences. No diagram yet — the next step draws it.

Scope:
{{ outputs.scope }}
