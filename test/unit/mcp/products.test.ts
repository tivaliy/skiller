/**
 * Tests for src/products.ts (generic category extraction)
 */
import { describe, it, expect } from 'vitest';
import { extractCategory } from '../../../src/products';

describe('extractCategory', () => {
    it('extracts the server name from mcp_mcp-<server>_ pattern', () => {
        expect(extractCategory('mcp_mcp-acme_item_search')).toBe('acme');
    });

    it('extracts the category from mcp__<category>__ pattern', () => {
        expect(extractCategory('mcp__github__get_file')).toBe('github');
    });

    it('extracts the category from mcp_<category>_ pattern', () => {
        expect(extractCategory('mcp_custom_action')).toBe('custom');
    });

    it('is case-insensitive', () => {
        expect(extractCategory('MCP__GitHub__GetFile')).toBe('github');
    });

    it('falls back to "other" when no pattern matches', () => {
        expect(extractCategory('some_random_tool')).toBe('other');
    });

    it('does not return "mcp" as a category for double-mcp-prefixed tools', () => {
        expect(extractCategory('mcp_mcp-github_get_file')).toBe('github');
    });
});
