/**
 * Shared utility functions for skills module
 */

/**
 * Whether an input value is present (not one of the three "absent" markers used
 * throughout input resolution: `undefined`, `null`, or the empty string). Note a
 * falsy-but-present value (`0`, `false`, `[]`) counts as present. Shared so the
 * resolver, the prompt-vs-skip decision, and code-action matching agree on what
 * "empty" means instead of each spelling out a slightly different check.
 */
export function hasValue(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '';
}

/**
 * Format a duration in milliseconds as a short human-readable string.
 * Invalid (non-finite or negative) inputs are clamped to 0.
 */
export function formatDuration(ms: number): string {
    const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
    if (safe < 1000) {
        return `${Math.round(safe)}ms`;
    }
    return `${(safe / 1000).toFixed(1)}s`;
}

/**
 * Wrap text in a fenced code block, neutralizing any inner triple-backticks so
 * the content cannot break out of the block.
 */
export function fence(text: string): string {
    return '```\n' + text.replace(/```/g, '` ` `') + '\n```';
}

/**
 * Calculate Levenshtein distance between two strings
 *
 * Used for typo detection and suggesting similar keys/values.
 * Returns the minimum number of single-character edits (insertions,
 * deletions, or substitutions) required to transform one string into another.
 */
export function levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = a[j - 1] === b[i - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }

    return matrix[b.length][a.length];
}

/**
 * Find similar strings from a set of candidates using Levenshtein distance
 *
 * @param target - The string to find similar matches for
 * @param candidates - Set or iterable of candidate strings to compare against
 * @param maxDistance - Maximum edit distance to consider a match (default: 2)
 * @returns Array of similar strings within the distance threshold
 */
export function findSimilarStrings(
    target: string,
    candidates: Iterable<string>,
    maxDistance: number = 2
): string[] {
    const similar: string[] = [];
    for (const candidate of candidates) {
        if (levenshteinDistance(target.toLowerCase(), candidate.toLowerCase()) <= maxDistance) {
            similar.push(candidate);
        }
    }
    return similar;
}
