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

/** The length of the longest run of backticks in `text` (0 when none). */
function longestBacktickRun(text: string): number {
    return Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length));
}

/**
 * A Markdown code block whose fence is longer than any backtick run inside, so the
 * text is shown verbatim and cannot end the block early.
 */
export function fencedBlock(text: string, language = ''): string {
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
    return `${fence}${language}\n${text}\n${fence}`;
}

/**
 * A Markdown code span that shows `text` verbatim on one line: delimited by a backtick
 * run longer than any inside, and padded when the text touches a backtick or a space
 * (CommonMark strips one padding space from each side).
 */
export function codeSpan(text: string): string {
    const flat = text.replace(/\r\n|\r|\n/g, ' ');
    const ticks = '`'.repeat(longestBacktickRun(flat) + 1);
    const pad = flat === '' || /^[` ]|[` ]$/.test(flat) ? ' ' : '';
    return `${ticks}${pad}${flat}${pad}${ticks}`;
}

/**
 * Escape `text` for inline Markdown (for example inside `**…**`): backslash-escapes the
 * characters that start emphasis, code, links, HTML, or entities, and puts line breaks
 * on one line. Ordinary paths and ids (letters, digits, `.`, `-`, `/`) are unchanged.
 */
export function escapeMarkdown(text: string): string {
    return text.replace(/\r\n|\r|\n/g, ' ').replace(/[\\`*_[\]<>&~]/g, ch => `\\${ch}`);
}

/**
 * Strip one markdown code fence that wraps the whole content (LLMs routinely wrap
 * output in ```lang despite prompting). Content made of two separate fenced blocks,
 * or with a fence only inside, is returned unchanged. CRLF-aware: inner line endings
 * are kept, and the line break before the closing fence is dropped with it.
 */
export function stripCodeFence(content: string): string {
    const lines = content.split('\n'); // a CRLF line keeps its trailing '\r'
    let start = 0;
    let end = lines.length - 1;
    while (start <= end && lines[start].trim() === '') start++;
    while (end >= start && lines[end].trim() === '') end--;
    if (end <= start || !lines[start].trim().startsWith('```') || lines[end].trim() !== '```') {
        return content;
    }
    const inner = lines.slice(start + 1, end);
    if (inner.some((l) => l.trimStart().startsWith('```'))) {
        return content;
    }
    return inner.join('\n').replace(/\r$/, '');
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
