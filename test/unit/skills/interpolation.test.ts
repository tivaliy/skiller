/**
 * Tests for skills/interpolation.ts
 *
 * Tests the template interpolation engine (LiquidJS wrapper)
 */

import { describe, it, expect, vi } from 'vitest';
import {
    extractExternalVariables,
    createEmptyContext,
    interpolate,
    evaluateCondition,
    tryCompileCondition,
} from '../../../src/skills/interpolation';
import { createMockExecutionContext } from '../../helpers/mocks/execution-context';
import { TEMPLATE_SAMPLES } from '../../helpers/fixtures';

// ============================================================================
// Pure Function Tests (No mocking needed)
// ============================================================================

describe('interpolation', () => {
    describe('extractExternalVariables', () => {
        it('extracts a simple variable', () => {
            expect(extractExternalVariables(TEMPLATE_SAMPLES.simpleVar)).toEqual(['name']);
        });

        it('extracts multiple variables', () => {
            const vars = extractExternalVariables(TEMPLATE_SAMPLES.multipleVars);
            expect(vars).toContain('greeting');
            expect(vars).toContain('name');
            expect(vars).toContain('id');
        });

        it('extracts nested path variables', () => {
            const vars = extractExternalVariables(TEMPLATE_SAMPLES.nestedPath);
            expect(vars).toContain('article.summary');
            expect(vars).toContain('article.status');
        });

        it('extracts deeply nested paths', () => {
            expect(extractExternalVariables(TEMPLATE_SAMPLES.deepNested))
                .toContain('report.metadata.author.name');
        });

        it('extracts variables from Liquid if tags', () => {
            expect(extractExternalVariables(TEMPLATE_SAMPLES.simpleIf)).toContain('status');
        });

        it('excludes for-loop locals but keeps the iterated collection', () => {
            const vars = extractExternalVariables(TEMPLATE_SAMPLES.simpleLoop);
            expect(vars).toContain('items');
            expect(vars).not.toContain('item'); // loop-local, not an external dependency
        });

        it('excludes {% assign %} locals but keeps their external inputs', () => {
            const vars = extractExternalVariables("{% assign t = a | append: b %}{{ t }}{{ c }}");
            expect(vars).toContain('a');
            expect(vars).toContain('b');
            expect(vars).toContain('c');
            expect(vars).not.toContain('t');
        });

        it('keeps a filter argument that references a variable (S-15 regression)', () => {
            // The old regex dropped everything after '|', losing filter-arg variables.
            const vars = extractExternalVariables('{{ x | append: y }}');
            expect(vars).toContain('x');
            expect(vars).toContain('y');
        });

        it('handles bracket access (static prefix + dynamic key)', () => {
            const vars = extractExternalVariables('{{ items[0] }} {{ outputs[key] }}');
            expect(vars).toContain('items');
            expect(vars).toContain('outputs');
            expect(vars).toContain('key'); // the dynamic key is its own dependency
        });

        it('does not treat a filter name as a variable', () => {
            expect(extractExternalVariables(TEMPLATE_SAMPLES.withFilter)).toEqual(['name']);
        });

        it('returns an empty array for templates with no variables', () => {
            expect(extractExternalVariables(TEMPLATE_SAMPLES.noVars)).toEqual([]);
            expect(extractExternalVariables(TEMPLATE_SAMPLES.emptyTemplate)).toEqual([]);
        });

        it('deduplicates repeated variables', () => {
            expect(extractExternalVariables(TEMPLATE_SAMPLES.duplicateVars)).toEqual(['name']);
        });

        it('ignores string literals inside conditions', () => {
            const vars = extractExternalVariables(
                '{% if inputs.focus_area == "All" or inputs.focus_area == "Forms" %}c{% endif %}'
            );
            expect(vars).toContain('inputs.focus_area');
            expect(vars).not.toContain('All');
            expect(vars).not.toContain('Forms');
        });

        it('ignores variables inside {% raw %} blocks', () => {
            const template = 'Real: {{ inputs.name }} {% raw %}{{ outputs.X.name }}{% endraw %}';
            const vars = extractExternalVariables(template);
            expect(vars).toContain('inputs.name');
            expect(vars.some((v) => v.startsWith('outputs'))).toBe(false);
        });

        it('returns [] for an unparseable template instead of throwing', () => {
            expect(() => extractExternalVariables('{{ unclosed')).not.toThrow();
            expect(extractExternalVariables('{{ unclosed')).toEqual([]);
        });
    });

    describe('createEmptyContext', () => {
        it('creates a valid empty ExecutionContext', () => {
            const ctx = createEmptyContext();

            expect(ctx.inputs).toEqual({});
            expect(ctx.outputs).toEqual({});
            expect(ctx.currentStep).toBe(0);
            expect(ctx.totalSteps).toBe(0);
            expect(ctx.availableMcps).toEqual([]);
            expect(typeof ctx.startTime).toBe('number');
        });

        it('creates independent contexts on each call', () => {
            const ctx1 = createEmptyContext();
            const ctx2 = createEmptyContext();

            ctx1.inputs['foo'] = 'bar';
            expect(ctx2.inputs).toEqual({});
        });

        it('has empty stepTimes object', () => {
            const ctx = createEmptyContext();
            expect(ctx.stepTimes).toEqual({});
        });
    });

    // ============================================================================
    // Context-Dependent Tests (with mock ExecutionContext)
    // ============================================================================

    describe('interpolate', () => {
        it('interpolates simple variables', () => {
            const ctx = createMockExecutionContext({
                inputs: { name: 'Alice' },
            });

            const result = interpolate('Hello {{ name }}!', ctx);
            expect(result).toBe('Hello Alice!');
        });

        it('interpolates nested output paths', () => {
            const ctx = createMockExecutionContext({
                outputs: {
                    article: { summary: 'Fix login issue', status: 'Open' },
                },
            });

            const result = interpolate(TEMPLATE_SAMPLES.nestedPath, ctx);
            expect(result).toBe('Article: Fix login issue (Open)');
        });

        it('handles missing variables gracefully in permissive mode (renders empty)', () => {
            const ctx = createMockExecutionContext();
            const result = interpolate('Hello {{ missing }}!', ctx, { strictVariables: false });
            expect(result).toBe('Hello !');
        });

        it('supports Liquid conditionals', () => {
            const ctx = createMockExecutionContext({
                inputs: { status: 'open' },
            });

            const result = interpolate(TEMPLATE_SAMPLES.simpleIf, ctx);
            expect(result).toBe('OPEN');
        });

        it('handles else branch in conditionals', () => {
            const ctx = createMockExecutionContext({
                inputs: { status: 'closed' },
            });

            const result = interpolate(TEMPLATE_SAMPLES.simpleIf, ctx);
            expect(result).toBe('CLOSED');
        });

        it('supports Liquid loops', () => {
            const ctx = createMockExecutionContext({
                inputs: { items: ['a', 'b', 'c'] },
            });

            const result = interpolate(TEMPLATE_SAMPLES.simpleLoop, ctx);
            expect(result).toBe('abc');
        });

        it('supports Liquid filters', () => {
            const ctx = createMockExecutionContext({
                inputs: { name: 'alice' },
            });

            const result = interpolate(TEMPLATE_SAMPLES.withFilter, ctx);
            expect(result).toBe('ALICE');
        });

        it('provides access to skill metadata', () => {
            const ctx = createMockExecutionContext({
                skill: { id: 'my-skill', name: 'My Skill', version: '2.0.0' },
            });

            const result = interpolate(
                'Running {{ skill.name }} v{{ skill.version }}',
                ctx
            );
            expect(result).toContain('My Skill');
            expect(result).toContain('2.0.0');
        });

        it('returns error message for invalid template syntax in permissive mode', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const ctx = createMockExecutionContext();
            const result = interpolate('{% invalid_tag %}', ctx, { strictVariables: false });
            expect(result).toContain('[Template Error');
            consoleSpy.mockRestore();
        });

        it('handles empty template', () => {
            const ctx = createMockExecutionContext();
            const result = interpolate('', ctx);
            expect(result).toBe('');
        });
    });

    describe('evaluateCondition', () => {
        it('evaluates truthy variable as true', () => {
            const ctx = createMockExecutionContext({
                inputs: { flag: true },
            });
            expect(evaluateCondition('flag', ctx)).toBe(true);
        });

        it('evaluates falsy variable as false', () => {
            const ctx = createMockExecutionContext({
                inputs: { flag: false },
            });
            expect(evaluateCondition('flag', ctx)).toBe(false);
        });

        it('evaluates equality comparison', () => {
            const ctx = createMockExecutionContext({
                inputs: { status: 'open' },
            });
            expect(evaluateCondition('status == "open"', ctx)).toBe(true);
            expect(evaluateCondition('status == "closed"', ctx)).toBe(false);
        });

        it('evaluates inequality comparison', () => {
            const ctx = createMockExecutionContext({
                inputs: { status: 'open' },
            });
            expect(evaluateCondition('status != "closed"', ctx)).toBe(true);
            expect(evaluateCondition('status != "open"', ctx)).toBe(false);
        });

        it('handles negation with !', () => {
            const ctx = createMockExecutionContext({
                inputs: { flag: true },
            });
            expect(evaluateCondition('!flag', ctx)).toBe(false);
        });

        it('handles double negation', () => {
            const ctx = createMockExecutionContext({
                inputs: { flag: true },
            });
            expect(evaluateCondition('!!flag', ctx)).toBe(true);
        });

        it('returns false for undefined variables', () => {
            const ctx = createMockExecutionContext();
            expect(evaluateCondition('undefined_var', ctx)).toBe(false);
        });

        it('handles nested path conditions', () => {
            const ctx = createMockExecutionContext({
                outputs: { result: { status: 'success' } },
            });
            expect(evaluateCondition('result.status == "success"', ctx)).toBe(true);
        });

        it('treats empty string as falsy', () => {
            const ctx = createMockExecutionContext({
                inputs: { value: '' },
            });
            expect(evaluateCondition('value', ctx)).toBe(false);
        });

        it('treats non-empty string as truthy', () => {
            const ctx = createMockExecutionContext({
                inputs: { value: 'greeter' },
            });
            expect(evaluateCondition('value', ctx)).toBe(true);
        });
    });

    describe('tryCompileCondition', () => {
        it('accepts a plain condition', () => {
            expect(tryCompileCondition('outputs.ready')).toBeNull();
        });

        it('accepts a single negation', () => {
            expect(tryCompileCondition('!outputs.ready')).toBeNull();
        });

        it('accepts double/chained negation (strips ! the same way the runtime does)', () => {
            // Runtime evaluateCondition peels every leading `!`; the validator must
            // too, or a valid `!!outputs.x` would be falsely rejected.
            expect(tryCompileCondition('!!outputs.ready')).toBeNull();
            expect(tryCompileCondition('!!!flag')).toBeNull();
        });

        it('still reports genuinely invalid conditions', () => {
            expect(tryCompileCondition('outputs.x ===')).not.toBeNull();
        });
    });
});
