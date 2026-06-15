/**
 * Graph Formatting Utilities
 *
 * Shared helpers for presenting graph-related labels.
 * Keep Mermaid-specific escaping in the renderer.
 */

export const DEFAULT_CONDITION_MAX_LEN = 80;

/**
 * Format a condition for display (truncate if too long).
 */
export function formatCondition(condition: string, maxLength: number = DEFAULT_CONDITION_MAX_LEN): string {
    if (condition.length <= maxLength) {
        return condition;
    }
    return condition.substring(0, maxLength - 3) + '...';
}
