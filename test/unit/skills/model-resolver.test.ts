/**
 * Tests for skills/model-resolver.ts
 *
 * Tests model resolution logic for per-step model selection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { VSCodeModelResolver } from '../../../src/skills/model-resolver';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock LanguageModelChat
 */
function createMockModel(id: string, overrides: Partial<vscode.LanguageModelChat> = {}): vscode.LanguageModelChat {
    return {
        id,
        name: id,
        vendor: 'test',
        family: 'test-family',
        version: '1.0',
        maxInputTokens: 128000,
        countTokens: vi.fn(),
        sendRequest: vi.fn(),
        ...overrides,
    } as unknown as vscode.LanguageModelChat;
}

// ============================================================================
// VSCodeModelResolver Tests
// ============================================================================

describe('VSCodeModelResolver', () => {
    let resolver: VSCodeModelResolver;
    let mockModels: vscode.LanguageModelChat[];

    beforeEach(() => {
        resolver = new VSCodeModelResolver();
        mockModels = [
            createMockModel('gpt-4o'),
            createMockModel('gpt-4o-mini'),
            createMockModel('gpt-4o-2024-05-13'),
            createMockModel('claude-opus-4-5-20251101'),
        ];

        // Mock vscode.lm.selectChatModels
        vi.mocked(vscode.lm.selectChatModels).mockResolvedValue(mockModels);
    });

    describe('resolve - one path: step model, then skill default, then the run model', () => {
        it('the run model never overrides a step model', async () => {
            const runModel = createMockModel('run-model');

            const result = await resolver.resolve('fast', { fast: 'gpt-4o-mini' }, 'gpt-4o', runModel);

            expect(result.model.id).toBe('gpt-4o-mini');
            expect(result.source).toBe('skill-step');
        });

        it('the run model never overrides the skill default', async () => {
            const runModel = createMockModel('run-model');

            const result = await resolver.resolve(undefined, undefined, 'gpt-4o', runModel);

            expect(result.model.id).toBe('gpt-4o');
            expect(result.source).toBe('skill-default');
        });
    });

    describe('resolve - step model', () => {
        it('resolves alias to model ID', async () => {
            const requestModel = createMockModel('auto-resolved');
            const aliases = { fast: 'gpt-4o-mini', smart: 'gpt-4o' };

            const result = await resolver.resolve(
                'fast',
                aliases,
                undefined,
                requestModel
            );

            expect(result.model.id).toBe('gpt-4o-mini');
            expect(result.source).toBe('skill-step');
            expect(result.usedFallback).toBe(false);
        });

        it('uses direct model ID when not an alias', async () => {
            const requestModel = createMockModel('auto-resolved');

            const result = await resolver.resolve(
                'gpt-4o',
                { fast: 'gpt-4o-mini' },
                undefined,
                requestModel
            );

            expect(result.model.id).toBe('gpt-4o');
            expect(result.source).toBe('skill-step');
        });

        it('matches versioned model names', async () => {
            const requestModel = createMockModel('auto-resolved');

            const result = await resolver.resolve(
                'gpt-4o',
                {},
                undefined,
                requestModel
            );

            // Should find gpt-4o (exact match exists)
            expect(result.model.id).toBe('gpt-4o');
        });
    });

    describe('resolve - skill default', () => {
        it('uses skill default when no step model specified', async () => {
            const requestModel = createMockModel('auto-resolved');

            const result = await resolver.resolve(
                undefined,        // no step model
                { fast: 'gpt-4o-mini' },
                'gpt-4o',        // skill default
                requestModel
            );

            expect(result.model.id).toBe('gpt-4o');
            expect(result.source).toBe('skill-default');
        });
    });

    describe('resolve - no config', () => {
        it('returns request model when no model config exists', async () => {
            const requestModel = createMockModel('auto-resolved');

            const result = await resolver.resolve(
                undefined,
                undefined,
                undefined,
                requestModel
            );

            expect(result.model).toBe(requestModel);
            expect(result.source).toBe('auto');
            expect(result.usedFallback).toBe(false);
        });
    });

    describe('resolve - fallback behavior', () => {
        it('falls back to request model when specified model not found', async () => {
            const requestModel = createMockModel('auto-resolved');

            const result = await resolver.resolve(
                'nonexistent-model',
                {},
                undefined,
                requestModel
            );

            expect(result.model).toBe(requestModel);
            expect(result.usedFallback).toBe(true);
            expect(result.requestedModel).toBe('nonexistent-model');
            expect(result.source).toBe('skill-step');
        });

        it('falls back when alias points to nonexistent model', async () => {
            const requestModel = createMockModel('auto-resolved');

            const result = await resolver.resolve(
                'fast',
                { fast: 'nonexistent-model' },
                undefined,
                requestModel
            );

            expect(result.model).toBe(requestModel);
            expect(result.usedFallback).toBe(true);
            expect(result.requestedModel).toBe('nonexistent-model');
        });
    });

    describe('resolve - versioned prefix matching', () => {
        it('matches base model to versioned variant', async () => {
            // Remove exact 'gpt-4o' match to test versioned matching
            const versionedModels = [
                createMockModel('gpt-4o-2024-05-13'),
                createMockModel('gpt-4o-mini'),
            ];
            vi.mocked(vscode.lm.selectChatModels).mockResolvedValue(versionedModels);

            // Create fresh resolver to clear cache
            const freshResolver = new VSCodeModelResolver();
            const requestModel = createMockModel('auto-resolved');

            const result = await freshResolver.resolve(
                'gpt-4o',
                {},
                undefined,
                requestModel
            );

            // Should match gpt-4o-2024-05-13 (versioned prefix match)
            expect(result.model.id).toBe('gpt-4o-2024-05-13');
            expect(result.usedFallback).toBe(false);
        });

        it('does not match partial model names (prevents gpt matching gpt-4o)', async () => {
            const requestModel = createMockModel('auto-resolved');

            const result = await resolver.resolve(
                'gpt',            // Too short, should not match gpt-4o
                {},
                undefined,
                requestModel
            );

            // Should fall back since 'gpt' doesn't match 'gpt-4o' (not a versioned suffix)
            expect(result.usedFallback).toBe(true);
            expect(result.requestedModel).toBe('gpt');
        });
    });

    describe('caching behavior', () => {
        it('caches model list across multiple resolves', async () => {
            const requestModel = createMockModel('auto-resolved');

            // Resolve multiple times
            await resolver.resolve('gpt-4o', {}, undefined, requestModel);
            await resolver.resolve('gpt-4o-mini', {}, undefined, requestModel);
            await resolver.resolve('claude-opus-4-5-20251101', {}, undefined, requestModel);

            // selectChatModels should only be called once
            expect(vscode.lm.selectChatModels).toHaveBeenCalledTimes(1);
        });
    });

    describe('displayName extraction', () => {
        it('removes date suffix from model ID', async () => {
            const requestModel = createMockModel('auto-resolved');

            const result = await resolver.resolve(
                'gpt-4o-2024-05-13',
                {},
                undefined,
                requestModel
            );

            expect(result.displayName).toBe('gpt-4o');
        });

        it('removes 8-digit date suffix', async () => {
            const requestModel = createMockModel('auto-resolved');

            const result = await resolver.resolve(
                'claude-opus-4-5-20251101',
                {},
                undefined,
                requestModel
            );

            expect(result.displayName).toBe('claude-opus-4-5');
        });

        it('preserves model ID without date suffix', async () => {
            const requestModel = createMockModel('auto-resolved');

            const result = await resolver.resolve(
                'gpt-4o-mini',
                {},
                undefined,
                requestModel
            );

            expect(result.displayName).toBe('gpt-4o-mini');
        });
    });
});
