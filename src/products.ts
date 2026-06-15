/**
 * Tool category extraction.
 *
 * Categories are derived purely from MCP tool naming conventions —
 * no hardcoded product list.
 */

/**
 * Tool category - a short label derived from a tool's name.
 */
export type ToolCategory = string;

/**
 * Extract a category from a tool name using MCP naming patterns.
 *
 * Strategy:
 * 1. Extract from common MCP naming conventions
 * 2. Fall back to "other"
 */
export function extractCategory(toolName: string): ToolCategory {
    const lower = toolName.toLowerCase();

    const patterns = [
        /mcp_mcp-([^_]+)_/,   // mcp_mcp-<server>_ → extract server name
        /mcp__([^_]+)__/,     // mcp__<category>__action
        /mcp_([^_]+)_/,       // mcp_<category>_action
    ];

    for (const pattern of patterns) {
        const match = lower.match(pattern);
        if (match && match[1]) {
            const extracted = match[1].replace(/^mcp-/, '');
            if (extracted && extracted !== 'mcp') {
                return extracted;
            }
        }
    }

    return 'other';
}
