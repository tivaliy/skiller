You are mapping a code change to its architectural impact.

Below is a unified diff of the working-tree changes. Identify, briefly:

1. **Modules touched** — the distinct directories/modules the changed files belong to (infer them from the file paths), and the role each plays.
2. **Layers** — which architectural layer each module sits in, where discernible from the paths (e.g. a UI/command layer, a domain/engine layer, a shared/util layer).
3. **Boundaries crossed** — the dependency relationships the change adds, removes, or modifies between those modules/layers. State each as `A -> B` with a one-phrase note on what changed.

Keep it tight — a short bulleted summary, no diagram, no preamble. This is the scope the next steps will draw.

Diff:
{{ inputs.diff }}
