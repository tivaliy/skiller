/**
 * Tools Schema
 *
 * Defines the Zod schema for skill tool configuration.
 * This is the single source of truth for tools section validation.
 */

import { z } from 'zod';

/**
 * Tool alias value pattern
 *
 * Format: tool_name or tool_name? (optional marker)
 * The ? suffix marks a tool as optional.
 */
const toolAliasValueSchema = z.string().min(1, 'Tool name cannot be empty');

/**
 * Tools configuration schema (raw YAML format)
 *
 * Validates tools section before normalization.
 * Uses strict mode to reject unknown keys.
 */
export const toolsConfigSchema = z.object({
    /**
     * Tool aliases map friendly names to MCP tool names
     *
     * Format:
     * - `get_issue: mcp_jira_get_issue` - Required tool
     * - `mkdir: copilot_mkdir?` - Optional tool (? suffix)
     */
    aliases: z.record(z.string(), toolAliasValueSchema).optional()
}).strict();

/**
 * Inferred TypeScript types from the schema
 */
export type RawToolsConfig = z.input<typeof toolsConfigSchema>;
export type ToolsConfig = z.output<typeof toolsConfigSchema>;

/**
 * Known keys for tools section (derived from schema)
 */
export const KNOWN_TOOLS_KEYS = new Set(Object.keys(toolsConfigSchema.shape));
