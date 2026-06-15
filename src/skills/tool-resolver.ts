/**
 * Tool Resolver
 *
 * Resolves tool names to VS Code LanguageModelToolInformation objects.
 * Separates infrastructure concern from step handling logic.
 *
 * Supports optionality via `?` suffix:
 * - In aliases: `mkdir: copilot_createDirectory?` marks the tool as optional
 * - In step.tools: `copilot_readFile?` marks a direct tool reference as optional
 *
 * IMPORTANT: Tools are validated before execution via the readiness system.
 * The resolve() method will throw if REQUIRED tools are missing.
 */

import * as vscode from 'vscode';
import { parseAliasValue } from './parser';

// ============================================================================
// Errors
// ============================================================================

/**
 * Error thrown when tool resolution fails
 */
export class ToolResolutionError extends Error {
    constructor(
        message: string,
        public readonly missingTools: MissingToolInfo[]
    ) {
        super(message);
        this.name = 'ToolResolutionError';
    }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Information about a missing tool reference
 */
export interface MissingToolInfo {
    /** Friendly alias name if used (e.g., 'get_tools') */
    alias?: string;
    /** Resolved MCP tool name (e.g., 'example_getAvailableTools') */
    resolvedName: string;
    /** Tool category extracted from name prefix (e.g., 'example') */
    category: string;
    /** Whether this tool is optional (had ? suffix) */
    optional: boolean;
}

/**
 * Information about a successfully resolved tool
 */
export interface ResolvedToolInfo {
    /** Friendly alias name if used */
    alias?: string;
    /** The resolved MCP tool name */
    toolName: string;
    /** Whether this tool is optional */
    optional: boolean;
    /** The VS Code tool information object */
    tool: vscode.LanguageModelToolInformation;
}

/**
 * Result of validating tool references
 */
export interface ToolValidationResult {
    /** Whether all REQUIRED tools were found (optional tools don't affect this) */
    valid: boolean;
    /** Successfully resolved tools with metadata */
    resolved: ResolvedToolInfo[];
    /** Tools that could not be found */
    missing: MissingToolInfo[];
}

// ============================================================================
// Interface
// ============================================================================

/**
 * Interface for resolving MCP tools
 *
 * Abstraction allows for testing without VS Code dependencies.
 */
export interface ToolResolver {
    /**
     * Resolve tool names to tool information objects.
     * Throws ToolResolutionError if any tool is not found.
     *
     * NOTE: Validation should happen before execution via checkReadiness().
     * This method throwing indicates a bug - validation was bypassed.
     *
     * @param toolNames - Raw tool names from step definition
     * @param aliases - Tool alias mapping from skill
     * @returns Resolved tool information objects
     * @throws ToolResolutionError if any tool is not found
     */
    resolve(
        toolNames: string[],
        aliases: Record<string, string>
    ): vscode.LanguageModelToolInformation[];

    /**
     * Find a single tool by name
     *
     * @param toolName - Tool name to find
     * @returns Tool information or undefined if not found
     */
    findTool(toolName: string): vscode.LanguageModelToolInformation | undefined;

    /**
     * Validate that all tool references can be resolved.
     * Use this for pre-flight validation before execution.
     *
     * @param toolNames - Raw tool names from step definition
     * @param aliases - Tool alias mapping from skill
     * @returns Validation result with resolved tools and missing tool info
     */
    validateReferences(
        toolNames: string[],
        aliases: Record<string, string>
    ): ToolValidationResult;
}

/**
 * Default implementation using VS Code's lm.tools API
 */
export class VSCodeToolResolver implements ToolResolver {
    resolve(
        toolNames: string[],
        aliases: Record<string, string>
    ): vscode.LanguageModelToolInformation[] {
        if (toolNames.length === 0) {
            return [];
        }

        // Use validateReferences and throw if any REQUIRED tools are missing
        const result = this.validateReferences(toolNames, aliases);

        if (!result.valid) {
            // Only report required (non-optional) missing tools
            const requiredMissing = result.missing.filter(m => !m.optional);
            const missingNames = requiredMissing
                .map(m => m.alias ? `${m.alias} → ${m.resolvedName}` : m.resolvedName)
                .join(', ');

            throw new ToolResolutionError(
                `Cannot resolve required tools: ${missingNames}. This indicates a bug - validation should have caught this before execution.`,
                requiredMissing
            );
        }

        // Return only the tool objects (not the metadata wrapper)
        return result.resolved.map(r => r.tool);
    }

    findTool(toolName: string): vscode.LanguageModelToolInformation | undefined {
        return vscode.lm.tools.find(t => t.name === toolName);
    }

    validateReferences(
        toolNames: string[],
        aliases: Record<string, string>
    ): ToolValidationResult {
        const resolved: ResolvedToolInfo[] = [];
        const missing: MissingToolInfo[] = [];

        for (const rawName of toolNames) {
            // Determine optionality and resolve the tool name
            const { toolName, optional, alias } = this.resolveToolReference(rawName, aliases);

            const tool = vscode.lm.tools.find(t => t.name === toolName);

            if (tool) {
                resolved.push({
                    alias,
                    toolName,
                    optional,
                    tool
                });
            } else {
                // Extract category from tool name (e.g., 'example_getAvailableTools' → 'example')
                const category = extractCategory(toolName);

                missing.push({
                    alias,
                    resolvedName: toolName,
                    category,
                    optional
                });
            }
        }

        // Valid if no REQUIRED tools are missing (optional missing tools are OK)
        const hasRequiredMissing = missing.some(m => !m.optional);

        return {
            valid: !hasRequiredMissing,
            resolved,
            missing
        };
    }

    /**
     * Resolve a tool reference to its actual tool name and optionality.
     *
     * Resolution order:
     * 1. If rawName matches an alias, resolve the alias value; a trailing `?` on
     *    EITHER the step reference or the alias value makes the step optional.
     * 2. Otherwise, treat as direct tool name (parse ? from rawName)
     *
     * @param rawName - The name as written in step.tools (alias or direct name)
     * @param aliases - The skill's tool aliases mapping
     * @returns Resolved tool name, optionality, and alias if used
     */
    private resolveToolReference(
        rawName: string,
        aliases: Record<string, string>
    ): { toolName: string; optional: boolean; alias?: string } {
        // Check if rawName (without ?) is an alias
        const referenceOptional = rawName.endsWith('?');
        const cleanRawName = referenceOptional ? rawName.slice(0, -1) : rawName;

        if (cleanRawName in aliases) {
            // It's an alias - resolve its value, but honor a `?` on the step
            // reference too: writing `deploy?` means optional even if the alias
            // value itself isn't marked optional (otherwise the `?` would be
            // silently dropped and a missing tool would error instead of skip).
            const aliasValue = aliases[cleanRawName];
            const { toolName, optional } = parseAliasValue(aliasValue);
            return {
                toolName,
                optional: optional || referenceOptional,
                alias: cleanRawName
            };
        }

        // Not an alias - treat as direct tool name
        // Parse ? from the raw name itself
        if (rawName.endsWith('?')) {
            return {
                toolName: rawName.slice(0, -1),
                optional: true,
                alias: undefined
            };
        }

        return {
            toolName: rawName,
            optional: false,
            alias: undefined
        };
    }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Extract MCP category from tool name.
 * Tools follow naming convention: category_toolName (e.g., 'skiller_createFile', 'jira_get_issue')
 */
function extractCategory(toolName: string): string {
    const underscoreIndex = toolName.indexOf('_');
    if (underscoreIndex > 0) {
        return toolName.substring(0, underscoreIndex);
    }
    // Fallback: return 'unknown' if no underscore pattern
    return 'unknown';
}

/**
 * Create the default tool resolver
 */
export function createToolResolver(): ToolResolver {
    return new VSCodeToolResolver();
}
