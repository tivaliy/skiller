Refactor the {{ inputs.language }} selection below to fix these smells:

{{ outputs.smells }}

Scope and behavior:
- Refactor ONLY the provided selection — your output replaces the selection in place.
- Preserve observable behavior, the public API, and imports exactly.
- Keep the surrounding indentation so the result drops into the original spot.
- Change only what removes the smells above; leave everything else as-is. Do not
  reorganize, rename, or reformat unrelated code.

Output format — CRITICAL, read carefully:
- Output the raw refactored code ONLY.
- Do NOT wrap it in markdown code fences. Your reply must not contain ``` anywhere.
- Do NOT add explanations, notes, or any prose before or after the code.
- The first character of your reply must be the first character of the code.

Selection:
{{ inputs.code }}
