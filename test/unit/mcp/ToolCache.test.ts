/**
 * Tests for ToolCache class
 *
 * Tests the class-based tool caching functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolCache, CachedTool, ToolsProvider } from '../../../src/ToolCache';

/**
 * Create a mock VS Code tool for testing
 */
function createMockTool(
    name: string,
    description: string = 'Test tool',
    inputSchema?: {
        type: string;
        properties?: Record<string, { type?: string; description?: string }>;
        required?: string[];
    }
): { name: string; description: string; inputSchema?: unknown } {
    return {
        name,
        description,
        inputSchema: inputSchema ?? {
            type: 'object',
            properties: {},
            required: []
        }
    };
}

describe('ToolCache', () => {
    let toolCache: ToolCache;
    let mockTools: ReturnType<typeof createMockTool>[];
    let toolsProvider: ToolsProvider;

    beforeEach(() => {
        mockTools = [];
        toolsProvider = () => mockTools as unknown as readonly import('vscode').LanguageModelToolInformation[];
        toolCache = new ToolCache(toolsProvider);
    });

    describe('constructor and refresh', () => {
        it('creates empty cache initially', () => {
            expect(toolCache.getAllTools()).toEqual([]);
        });

        it('populates cache on refresh', () => {
            mockTools = [
                createMockTool('mcp_mcp-acme_item_search', 'Search Acme items')
            ];

            toolCache.refresh();

            expect(toolCache.getAllTools()).toHaveLength(1);
        });

        it('clears previous tools on refresh', () => {
            mockTools = [createMockTool('tool1')];
            toolCache.refresh();
            expect(toolCache.getAllTools()).toHaveLength(1);

            mockTools = [createMockTool('tool2'), createMockTool('tool3')];
            toolCache.refresh();
            expect(toolCache.getAllTools()).toHaveLength(2);
            expect(toolCache.getAllTools().find(t => t.name === 'tool1')).toBeUndefined();
        });
    });

    describe('getAllTools', () => {
        it('returns empty array when no tools', () => {
            toolCache.refresh();
            expect(toolCache.getAllTools()).toEqual([]);
        });

        it('returns all cached tools', () => {
            mockTools = [
                createMockTool('mcp_mcp-acme_item_search'),
                createMockTool('mcp__github__get_file'),
                createMockTool('mcp_jenkins_get_build')
            ];
            toolCache.refresh();

            expect(toolCache.getAllTools()).toHaveLength(3);
        });
    });

    describe('getToolsByCategory', () => {
        beforeEach(() => {
            mockTools = [
                // mcp_mcp-<server>_ pattern extracts the server name: 'acme'
                createMockTool('mcp_mcp-acme_item_search'),
                createMockTool('mcp_mcp-acme_item_get'),
                createMockTool('mcp__github__get_file'),
                createMockTool('mcp_jenkins_get_build')
            ];
            toolCache.refresh();
        });

        it('returns tools for specific category', () => {
            // extractCategory('mcp_mcp-acme_*') → 'acme' (server name from pattern)
            const acmeTools = toolCache.getToolsByCategory('acme');
            expect(acmeTools).toHaveLength(2);
            expect(acmeTools.every(t => t.category === 'acme')).toBe(true);
        });

        it('returns empty array for non-existent category', () => {
            const slackTools = toolCache.getToolsByCategory('slack');
            expect(slackTools).toEqual([]);
        });
    });

    describe('getToolByName', () => {
        beforeEach(() => {
            mockTools = [
                createMockTool('mcp_mcp-acme_item_search', 'Search Acme'),
                createMockTool('mcp__github__get_file', 'Get GitHub file')
            ];
            toolCache.refresh();
        });

        it('finds tool by full name', () => {
            const tool = toolCache.getToolByName('mcp_mcp-acme_item_search');
            expect(tool).toBeDefined();
            expect(tool?.description).toBe('Search Acme');
        });

        it('finds tool by short name', () => {
            const tool = toolCache.getToolByName('item_search');
            expect(tool).toBeDefined();
            expect(tool?.name).toBe('mcp_mcp-acme_item_search');
        });

        it('returns undefined for non-existent tool', () => {
            const tool = toolCache.getToolByName('non_existent_tool');
            expect(tool).toBeUndefined();
        });
    });

    describe('shortName extraction', () => {
        const shortNameOf = (fullName: string): string => {
            mockTools = [createMockTool(fullName)];
            toolCache.refresh();
            return toolCache.getAllTools()[0].shortName;
        };

        it('strips the nested mcp_mcp-<server>_ prefix to the action', () => {
            expect(shortNameOf('mcp_mcp-acme_item_search')).toBe('item_search');
        });

        it('handles hyphenated multi-word server ids', () => {
            expect(shortNameOf('mcp_mcp-my-server_get_issue')).toBe('get_issue');
        });

        it('keeps the server for the mcp__server__action form', () => {
            expect(shortNameOf('mcp__github__get_file')).toBe('github_get_file');
        });

        it('keeps the server for the single mcp_server_action form', () => {
            expect(shortNameOf('mcp_server_action')).toBe('server_action');
        });

        it('falls back to the full name for non-mcp tool names', () => {
            expect(shortNameOf('skiller_createFile')).toBe('skiller_createFile');
        });

        it('does not treat a mid-name mcp_ fragment as the prefix (anchored)', () => {
            // Starts with 'x', not 'mcp_': falls back to the last two segments.
            expect(shortNameOf('x_mcp_foo_bar')).toBe('foo_bar');
        });
    });

    describe('getDiscoveredCategories', () => {
        it('returns empty array when no tools', () => {
            toolCache.refresh();
            expect(toolCache.getDiscoveredCategories()).toEqual([]);
        });

        it('returns sorted categories', () => {
            mockTools = [
                createMockTool('mcp_jenkins_build'),
                // mcp_mcp-<server>_ → 'acme' (server name)
                createMockTool('mcp_mcp-acme_item_search'),
                createMockTool('mcp__github__get_file')
            ];
            toolCache.refresh();

            const categories = toolCache.getDiscoveredCategories();
            expect(categories).toEqual(['acme', 'github', 'jenkins']);
        });
    });

    describe('hasTools', () => {
        it('returns false when no tools', () => {
            toolCache.refresh();
            expect(toolCache.hasTools()).toBe(false);
        });

        it('returns true when tools exist', () => {
            mockTools = [createMockTool('mcp_test_tool')];
            toolCache.refresh();
            expect(toolCache.hasTools()).toBe(true);
        });
    });

    describe('hasCategory', () => {
        beforeEach(() => {
            mockTools = [
                // mcp_mcp-<server>_ → 'acme'; mcp__<cat>__ → 'github'
                createMockTool('mcp_mcp-acme_item_search'),
                createMockTool('mcp__github__get_file')
            ];
            toolCache.refresh();
        });

        it('returns true for existing category', () => {
            expect(toolCache.hasCategory('acme')).toBe(true);
            expect(toolCache.hasCategory('github')).toBe(true);
        });

        it('returns false for non-existent category', () => {
            expect(toolCache.hasCategory('slack')).toBe(false);
        });
    });

    describe('getStatus', () => {
        it('returns not available when no tools', () => {
            toolCache.refresh();
            const status = toolCache.getStatus();

            expect(status.available).toBe(false);
            expect(status.categories).toEqual([]);
        });

        it('returns available when tools exist', () => {
            mockTools = [
                // mcp_mcp-<server>_ → 'acme'; mcp__<cat>__ → 'github'
                createMockTool('mcp_mcp-acme_item_search'),
                createMockTool('mcp__github__get_file')
            ];
            toolCache.refresh();

            const status = toolCache.getStatus();

            expect(status.available).toBe(true);
            expect(status.categories).toContain('acme');
            expect(status.categories).toContain('github');
        });
    });

    describe('forceRefreshWithDiff', () => {
        it('detects added tools', () => {
            mockTools = [createMockTool('mcp_mcp-acme_item_search')];
            toolCache.refresh();

            mockTools = [
                createMockTool('mcp_mcp-acme_item_search'),
                createMockTool('mcp__github__get_file')
            ];

            const result = toolCache.forceRefreshWithDiff();

            expect(result.beforeCount).toBe(1);
            expect(result.afterCount).toBe(2);
            expect(result.added).toContain('github_get_file');
        });

        it('detects removed tools', () => {
            mockTools = [
                createMockTool('mcp_mcp-acme_item_search'),
                createMockTool('mcp__github__get_file')
            ];
            toolCache.refresh();

            mockTools = [createMockTool('mcp_mcp-acme_item_search')];

            const result = toolCache.forceRefreshWithDiff();

            expect(result.beforeCount).toBe(2);
            expect(result.afterCount).toBe(1);
            expect(result.removed).toContain('github_get_file');
        });
    });
});
