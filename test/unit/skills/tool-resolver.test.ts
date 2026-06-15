/**
 * Tests for skills/tool-resolver.ts
 *
 * Tests tool resolution logic including:
 * - validateReferences() for pre-flight validation
 * - resolve() fail-fast behavior
 * - findTool() lookup
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import {
    VSCodeToolResolver,
    ToolResolutionError,
    type MissingToolInfo
} from '../../../src/skills/tool-resolver';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock tool for testing
 */
function createMockTool(name: string): vscode.LanguageModelToolInformation {
    return {
        name,
        description: `Mock tool: ${name}`,
        inputSchema: { type: 'object', properties: {} }
    } as vscode.LanguageModelToolInformation;
}

/**
 * Set up mock tools in vscode.lm.tools
 */
function setMockTools(tools: vscode.LanguageModelToolInformation[]): void {
    // @ts-expect-error - we're modifying the mock
    vscode.lm.tools = tools;
}

// ============================================================================
// VSCodeToolResolver Tests
// ============================================================================

describe('VSCodeToolResolver', () => {
    let resolver: VSCodeToolResolver;

    beforeEach(() => {
        resolver = new VSCodeToolResolver();
        // Set up some default mock tools
        setMockTools([
            createMockTool('skiller_createFile'),
            createMockTool('example_readFile'),
            createMockTool('copilot_createDirectory'),
            createMockTool('item_get'),
        ]);
    });

    afterEach(() => {
        setMockTools([]);
    });

    // ========================================================================
    // findTool Tests
    // ========================================================================

    describe('findTool', () => {
        it('finds tool by exact name', () => {
            const tool = resolver.findTool('skiller_createFile');
            expect(tool).toBeDefined();
            expect(tool?.name).toBe('skiller_createFile');
        });

        it('returns undefined for non-existent tool', () => {
            const tool = resolver.findTool('nonexistent_tool');
            expect(tool).toBeUndefined();
        });

        it('is case-sensitive', () => {
            const tool = resolver.findTool('Skiller_CreateFile');
            expect(tool).toBeUndefined();
        });
    });

    // ========================================================================
    // validateReferences Tests
    // ========================================================================

    describe('validateReferences', () => {
        it('returns valid result when all tools exist', () => {
            const result = resolver.validateReferences(
                ['skiller_createFile', 'example_readFile'],
                {}
            );

            expect(result.valid).toBe(true);
            expect(result.resolved).toHaveLength(2);
            expect(result.missing).toHaveLength(0);
        });

        it('resolves aliases to actual tool names', () => {
            const result = resolver.validateReferences(
                ['create', 'read'],
                { create: 'skiller_createFile', read: 'example_readFile' }
            );

            expect(result.valid).toBe(true);
            expect(result.resolved).toHaveLength(2);
            expect(result.resolved.map(t => t.toolName)).toEqual(['skiller_createFile', 'example_readFile']);
        });

        it('reports missing tools with alias info', () => {
            const result = resolver.validateReferences(
                ['get_tools'],
                { get_tools: 'example_getAvailableTools' }
            );

            expect(result.valid).toBe(false);
            expect(result.missing).toHaveLength(1);
            expect(result.missing[0]).toEqual({
                alias: 'get_tools',
                resolvedName: 'example_getAvailableTools',
                category: 'example',
                optional: false
            });
        });

        it('reports missing tools without alias when used directly', () => {
            const result = resolver.validateReferences(
                ['nonexistent_tool'],
                {}
            );

            expect(result.valid).toBe(false);
            expect(result.missing).toHaveLength(1);
            expect(result.missing[0]).toEqual({
                alias: undefined,
                resolvedName: 'nonexistent_tool',
                category: 'nonexistent',
                optional: false
            });
        });

        it('extracts category from tool name prefix', () => {
            const result = resolver.validateReferences(
                ['acme_missing_tool', 'docs_another_missing'],
                {}
            );

            expect(result.missing).toHaveLength(2);
            expect(result.missing[0].category).toBe('acme');
            expect(result.missing[1].category).toBe('docs');
        });

        it('uses "unknown" category for tools without underscore', () => {
            const result = resolver.validateReferences(
                ['toolwithoutprefix'],
                {}
            );

            expect(result.missing[0].category).toBe('unknown');
        });

        it('handles empty tool list', () => {
            const result = resolver.validateReferences([], {});

            expect(result.valid).toBe(true);
            expect(result.resolved).toHaveLength(0);
            expect(result.missing).toHaveLength(0);
        });

        it('handles mix of found and missing tools', () => {
            const result = resolver.validateReferences(
                ['skiller_createFile', 'missing_tool', 'item_get'],
                {}
            );

            expect(result.valid).toBe(false);
            expect(result.resolved).toHaveLength(2);
            expect(result.missing).toHaveLength(1);
            expect(result.resolved.map(t => t.toolName)).toEqual(['skiller_createFile', 'item_get']);
        });

        it('parses optional marker from alias value', () => {
            const result = resolver.validateReferences(
                ['optional_tool'],
                { optional_tool: 'nonexistent_optional?' }
            );

            expect(result.valid).toBe(true);  // Optional missing tools don't affect validity
            expect(result.missing).toHaveLength(1);
            expect(result.missing[0].optional).toBe(true);
            expect(result.missing[0].resolvedName).toBe('nonexistent_optional');
        });

        it('parses optional marker from direct tool name', () => {
            const result = resolver.validateReferences(
                ['nonexistent_tool?'],
                {}
            );

            expect(result.valid).toBe(true);  // Optional missing tools don't affect validity
            expect(result.missing).toHaveLength(1);
            expect(result.missing[0].optional).toBe(true);
            expect(result.missing[0].resolvedName).toBe('nonexistent_tool');
        });

        it('honors a ? on the step reference to a required alias (alias? => optional, not required-error)', () => {
            // alias `deploy` -> required tool. Referencing it as `deploy?` must make
            // the step optional (skip if missing), not silently flip to required.
            const result = resolver.validateReferences(
                ['deploy?'],
                { deploy: 'nonexistent_deploy_tool' }
            );

            expect(result.valid).toBe(true);            // optional => missing doesn't fail validation
            expect(result.missing).toHaveLength(1);
            expect(result.missing[0].optional).toBe(true);
            expect(result.missing[0].alias).toBe('deploy');
            expect(result.missing[0].resolvedName).toBe('nonexistent_deploy_tool');
        });

        it('returns valid=true when only optional tools are missing', () => {
            const result = resolver.validateReferences(
                ['skiller_createFile', 'missing?'],
                { 'missing?': 'nonexistent?' }  // This won't work - ? on key doesn't matter
            );

            // The ? on the VALUE matters, not the key
            const result2 = resolver.validateReferences(
                ['skiller_createFile', 'optional'],
                { optional: 'nonexistent?' }
            );

            expect(result2.valid).toBe(true);
            expect(result2.resolved).toHaveLength(1);
            expect(result2.missing).toHaveLength(1);
            expect(result2.missing[0].optional).toBe(true);
        });
    });

    // ========================================================================
    // resolve Tests (fail-fast behavior)
    // ========================================================================

    describe('resolve', () => {
        it('returns resolved tools when all exist', () => {
            const tools = resolver.resolve(
                ['skiller_createFile', 'example_readFile'],
                {}
            );

            expect(tools).toHaveLength(2);
            expect(tools.map(t => t.name)).toEqual(['skiller_createFile', 'example_readFile']);
        });

        it('resolves aliases correctly', () => {
            const tools = resolver.resolve(
                ['create'],
                { create: 'skiller_createFile' }
            );

            expect(tools).toHaveLength(1);
            expect(tools[0].name).toBe('skiller_createFile');
        });

        it('returns empty array for empty input', () => {
            const tools = resolver.resolve([], {});
            expect(tools).toHaveLength(0);
        });

        it('throws ToolResolutionError when tool is missing', () => {
            expect(() => {
                resolver.resolve(['missing_tool'], {});
            }).toThrow(ToolResolutionError);
        });

        it('includes missing tool info in error', () => {
            try {
                resolver.resolve(['get_tools'], { get_tools: 'example_getAvailableTools' });
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(ToolResolutionError);
                const resolutionError = error as ToolResolutionError;
                expect(resolutionError.missingTools).toHaveLength(1);
                expect(resolutionError.missingTools[0].resolvedName).toBe('example_getAvailableTools');
                expect(resolutionError.missingTools[0].alias).toBe('get_tools');
            }
        });

        it('error message includes all missing tools', () => {
            try {
                resolver.resolve(
                    ['tool1', 'tool2'],
                    { tool1: 'missing_a', tool2: 'missing_b' }
                );
                expect.fail('Should have thrown');
            } catch (error) {
                const resolutionError = error as ToolResolutionError;
                expect(resolutionError.message).toContain('tool1 → missing_a');
                expect(resolutionError.message).toContain('tool2 → missing_b');
            }
        });

        it('error message indicates this is a bug (validation bypassed)', () => {
            try {
                resolver.resolve(['missing_tool'], {});
                expect.fail('Should have thrown');
            } catch (error) {
                const resolutionError = error as ToolResolutionError;
                expect(resolutionError.message).toContain('bug');
                expect(resolutionError.message).toContain('validation');
            }
        });
    });
});

// ============================================================================
// ToolResolutionError Tests
// ============================================================================

describe('ToolResolutionError', () => {
    it('is an Error subclass', () => {
        const error = new ToolResolutionError('test', []);
        expect(error).toBeInstanceOf(Error);
    });

    it('has correct name', () => {
        const error = new ToolResolutionError('test', []);
        expect(error.name).toBe('ToolResolutionError');
    });

    it('stores missing tools info', () => {
        const missingTools: MissingToolInfo[] = [
            { alias: 'get', resolvedName: 'example_get', category: 'example', optional: false }
        ];
        const error = new ToolResolutionError('test', missingTools);
        expect(error.missingTools).toEqual(missingTools);
    });

    it('can be caught by error type', () => {
        const error = new ToolResolutionError('test', []);

        try {
            throw error;
        } catch (e) {
            if (e instanceof ToolResolutionError) {
                expect(e.missingTools).toEqual([]);
            } else {
                expect.fail('Should have caught ToolResolutionError');
            }
        }
    });
});
