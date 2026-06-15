/**
 * Tool Cache (Class-based)
 *
 * Manages discovery and caching of VS Code Language Model tools from vscode.lm.tools.
 * Replaces the module-singleton pattern with an injectable class for better testability.
 *
 * Categories are extracted automatically from tool naming patterns,
 * eliminating the need for hardcoded category lists.
 */

import * as vscode from 'vscode';
import { extractCategory, ToolCategory } from './products';

// Re-export ToolCategory for consumers
export type { ToolCategory };

/**
 * Cached tool with parsed metadata
 */
export interface CachedTool {
    name: string;
    description: string;
    category: ToolCategory;
    inputSchema: ToolInputSchema;
    /** Human-readable short name, e.g., "jira_search" from "mcp_mcp-atlassian_jira_search" */
    shortName: string;
    requiredParams: string[];
    optionalParams: string[];
}

/**
 * Tool input schema structure
 */
export interface ToolInputSchema {
    type: string;
    properties?: Record<string, {
        type?: string;
        description?: string;
        enum?: string[];
        default?: unknown;
    }>;
    required?: string[];
}

/**
 * Provider function type for VS Code tools.
 * Allows injection of mock tools in tests.
 */
export type ToolsProvider = () => readonly vscode.LanguageModelToolInformation[];

/**
 * Tool Cache
 *
 * Caches and organizes VS Code LM tools by dynamically discovered categories.
 * Accepts a tools provider function for dependency injection.
 *
 * @example
 * // Production usage
 * const cache = new ToolCache(() => vscode.lm.tools);
 *
 * // Test usage
 * const cache = new ToolCache(() => mockTools);
 */
export class ToolCache {
    private toolsByCategory: Map<ToolCategory, CachedTool[]> = new Map();
    private allTools: CachedTool[] = [];

    /**
     * Create a new tool cache.
     * @param toolsProvider Function that returns the current VS Code tools array.
     *                      Pass `() => vscode.lm.tools` in production.
     */
    constructor(private readonly toolsProvider: ToolsProvider) {}

    /**
     * Refresh the cache from the tools provider.
     * Call this on extension activation and when MCP configuration changes.
     */
    refresh(): void {
        const vsCodeTools = this.toolsProvider();

        // Reset cache - categories built dynamically
        this.toolsByCategory = new Map();
        this.allTools = [];

        // Process each tool (including built-in tools)
        for (const tool of vsCodeTools) {
            const category = extractCategory(tool.name);
            const schema = (tool.inputSchema || { type: 'object' }) as ToolInputSchema;
            const properties = schema.properties || {};
            const required = schema.required || [];

            const cachedTool: CachedTool = {
                name: tool.name,
                description: tool.description,
                category,
                inputSchema: schema,
                shortName: this.extractShortName(tool.name),
                requiredParams: required,
                optionalParams: Object.keys(properties).filter(p => !required.includes(p))
            };

            this.allTools.push(cachedTool);

            // Dynamically create category array if needed
            if (!this.toolsByCategory.has(category)) {
                this.toolsByCategory.set(category, []);
            }
            this.toolsByCategory.get(category)!.push(cachedTool);
        }

        const categoryList = Array.from(this.toolsByCategory.keys()).join(', ');
        console.log(`Tool cache refreshed: ${this.allTools.length} tools in categories [${categoryList}]`);
    }

    /**
     * Get all discovered categories, sorted alphabetically.
     */
    getDiscoveredCategories(): ToolCategory[] {
        this.ensureFresh();
        return Array.from(this.toolsByCategory.keys()).sort();
    }

    /**
     * Get all tools for a specific category.
     */
    getToolsByCategory(category: ToolCategory): CachedTool[] {
        this.ensureFresh();
        return this.toolsByCategory.get(category) || [];
    }

    /**
     * Get all cached tools.
     */
    getAllTools(): CachedTool[] {
        this.ensureFresh();
        return this.allTools;
    }

    /**
     * Get a specific tool by full name or short name.
     */
    getToolByName(name: string): CachedTool | undefined {
        this.ensureFresh();
        return this.allTools.find(t => t.name === name || t.shortName === name);
    }

    /**
     * Get tool count by category.
     */
    getToolCounts(): Map<ToolCategory, number> {
        this.ensureFresh();
        const counts = new Map<ToolCategory, number>();

        for (const [category, tools] of this.toolsByCategory) {
            counts.set(category, tools.length);
        }

        return counts;
    }

    /**
     * Check if any tools are available.
     */
    hasTools(): boolean {
        this.ensureFresh();
        return this.allTools.length > 0;
    }

    /**
     * Check if a specific category exists.
     */
    hasCategory(category: ToolCategory): boolean {
        this.ensureFresh();
        return this.toolsByCategory.has(category);
    }

    /**
     * Get status summary of available tools.
     */
    getStatus(): {
        available: boolean;
        categories: ToolCategory[];
        summary: Map<ToolCategory, number>;
    } {
        const categories = this.getDiscoveredCategories();
        const summary = this.getToolCounts();

        let totalTools = 0;
        for (const count of summary.values()) {
            totalTools += count;
        }

        return {
            available: totalTools > 0,
            categories,
            summary
        };
    }

    /**
     * Force refresh and return diff of what changed.
     */
    forceRefreshWithDiff(): {
        beforeCount: number;
        afterCount: number;
        added: string[];
        removed: string[];
        categories: ToolCategory[];
    } {
        // Capture before state
        const beforeTools = this.getAllTools();
        const beforeNames = new Set(beforeTools.map(t => t.name));
        const beforeCount = beforeTools.length;

        // Force refresh
        this.refresh();

        // Capture after state
        const afterTools = this.getAllTools();
        const afterNames = new Set(afterTools.map(t => t.name));
        const afterCount = afterTools.length;

        // Compute diff
        const added = afterTools
            .filter(t => !beforeNames.has(t.name))
            .map(t => t.shortName);

        const removed = beforeTools
            .filter(t => !afterNames.has(t.name))
            .map(t => t.shortName);

        return {
            beforeCount,
            afterCount,
            added,
            removed,
            categories: this.getDiscoveredCategories()
        };
    }

    /**
     * Ensure cache is populated (lazy initialization).
     */
    private ensureFresh(): void {
        if (this.allTools.length === 0) {
            this.refresh();
        }
    }

    /**
     * Derive a human-readable short name from a full MCP tool name.
     *
     * MCP tools follow `mcp_<server>_<action>` (VS Code emits a doubled
     * `mcp_mcp-<server>_<action>` when the configured server id itself starts with
     * `mcp-`). By convention server ids are hyphen-delimited (`mcp-atlassian`,
     * `mcp-my-server`) while actions are underscore-delimited (`jira_search`), so
     * the server is the run of non-underscore characters after the prefix and the
     * action is the remainder. Patterns are anchored to `^` so a `mcp_…` fragment
     * appearing mid-name can't be mistaken for the prefix.
     *
     * Caveat: a server id that itself contains an underscore violates this
     * convention and can't be split unambiguously from the name alone (nothing
     * separates it from the action); such a name yields a slightly longer short
     * name. Resolving that would require the configured MCP server registry.
     */
    private extractShortName(fullName: string): string {
        // Pattern: mcp_mcp-<server>_<action> → <action>
        // (e.g. mcp_mcp-atlassian_jira_search → jira_search). Hyphenated multi-word
        // servers (mcp-my-server) are matched correctly since [^_]+ includes hyphens.
        const nestedMcpMatch = fullName.match(/^mcp_mcp-[^_]+_(.+)/);
        if (nestedMcpMatch) {
            return nestedMcpMatch[1];
        }

        // Pattern: mcp__github__get_file → github_get_file
        const doubleUnderMatch = fullName.match(/^mcp__([^_]+)__(.+)/);
        if (doubleUnderMatch) {
            return `${doubleUnderMatch[1]}_${doubleUnderMatch[2]}`;
        }

        // Pattern: mcp_server_action → server_action
        const singleMatch = fullName.match(/^mcp_([^_]+)_(.+)/);
        if (singleMatch) {
            return `${singleMatch[1]}_${singleMatch[2]}`;
        }

        // Fallback: last 2 parts or full name
        const parts = fullName.split('_');
        if (parts.length > 2) {
            return parts.slice(-2).join('_');
        }

        return fullName;
    }
}
