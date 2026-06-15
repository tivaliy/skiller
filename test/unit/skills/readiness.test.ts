/**
 * Tests for skills/readiness module
 *
 * Tests the execution readiness system including:
 * - ToolAvailabilityCheck (validates individual tool references)
 * - ReadinessEngine
 * - Factory functions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Skill, SkillStep } from '../../../src/skills/types';
import type { ToolResolver, ToolValidationResult, MissingToolInfo, ResolvedToolInfo } from '../../../src/skills/tool-resolver';
import {
    ToolAvailabilityCheck,
    ReadinessEngine,
    checkReadiness,
    formatReadinessResult,
    createReadinessEngine,
    resetReadinessEngine
} from '../../../src/skills/readiness';
import type { ReadinessContext } from '../../../src/skills/readiness';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a minimal skill for testing
 */
function createTestSkill(overrides: Partial<Skill> = {}): Skill {
    return {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        version: '1.0.0',
        steps: [],
        inputs: [],
        tools: {
            aliases: {}
        },
        onError: 'abort',
        source: {
            type: 'workspace',
            path: '/test/path'
        },
        ...overrides
    };
}

/**
 * Create a test step
 */
function createTestStep(overrides: Partial<SkillStep> = {}): SkillStep {
    return {
        id: 'test-step',
        file: 'test.md',
        ...overrides
    };
}

/**
 * Create a mock tool resolver for testing
 *
 * @param options.availableTools - Tool names that exist
 * @param options.optionalTools - Tool names that are optional (marked with ?)
 */
function createMockToolResolver(options: {
    availableTools?: string[];
    optionalTools?: string[];
} = {}): ToolResolver {
    const { availableTools = [], optionalTools = [] } = options;

    return {
        resolve: vi.fn((toolNames: string[], aliases: Record<string, string>) => {
            // This would throw in real implementation if required tools missing
            return [];
        }),
        findTool: vi.fn((name: string) => {
            // Strip ? for lookup
            const cleanName = name.endsWith('?') ? name.slice(0, -1) : name;
            if (availableTools.includes(cleanName)) {
                return { name: cleanName, description: 'test', inputSchema: {} } as never;
            }
            return undefined;
        }),
        validateReferences: vi.fn((toolNames: string[], aliases: Record<string, string>): ToolValidationResult => {
            const resolved: ResolvedToolInfo[] = [];
            const missing: MissingToolInfo[] = [];

            for (const rawName of toolNames) {
                // Check if it's an alias
                const aliasValue = aliases[rawName];
                let toolName: string;
                let optional: boolean;
                let alias: string | undefined;

                if (aliasValue) {
                    // Resolve through alias
                    optional = aliasValue.endsWith('?');
                    toolName = optional ? aliasValue.slice(0, -1) : aliasValue;
                    alias = rawName;
                } else {
                    // Direct tool name
                    optional = rawName.endsWith('?') || optionalTools.includes(rawName);
                    toolName = rawName.endsWith('?') ? rawName.slice(0, -1) : rawName;
                    alias = undefined;
                }

                if (availableTools.includes(toolName)) {
                    resolved.push({
                        alias,
                        toolName,
                        optional,
                        tool: { name: toolName, description: 'test', inputSchema: {} } as never
                    });
                } else {
                    missing.push({
                        alias,
                        resolvedName: toolName,
                        category: toolName.split('_')[0] || 'unknown',
                        optional
                    });
                }
            }

            // valid is true if no REQUIRED tools are missing
            const hasRequiredMissing = missing.some(m => !m.optional);

            return {
                valid: !hasRequiredMissing,
                resolved,
                missing
            };
        })
    };
}

// ============================================================================
// ToolAvailabilityCheck Tests
// ============================================================================

describe('ToolAvailabilityCheck', () => {
    it('has correct id and name', () => {
        const check = new ToolAvailabilityCheck(createMockToolResolver());
        expect(check.id).toBe('tool-availability');
        expect(check.name).toBe('Tool Availability Check');
    });

    describe('check - alias validation', () => {
        it('passes when all aliased tools exist', () => {
            const toolResolver = createMockToolResolver({
                availableTools: ['skiller_createFile', 'example_readFile']
            });
            const check = new ToolAvailabilityCheck(toolResolver);

            const skill = createTestSkill({
                tools: {
                    aliases: { create: 'skiller_createFile', read: 'example_readFile' }
                }
            });

            const result = check.check(skill, {});

            expect(result.ready).toBe(true);
            expect(result.missingTools).toHaveLength(0);
        });

        it('fails when aliased tool is missing (required by default)', () => {
            const toolResolver = createMockToolResolver({
                availableTools: []
            });
            const check = new ToolAvailabilityCheck(toolResolver);

            const skill = createTestSkill({
                tools: {
                    aliases: { get_tools: 'example_getAvailableTools' }
                }
            });

            const result = check.check(skill, {});

            expect(result.ready).toBe(false);
            expect(result.missingTools).toHaveLength(1);
            expect(result.missingTools[0].resolvedName).toBe('example_getAvailableTools');
            expect(result.missingTools[0].optional).toBe(false);
        });

        it('warns but allows when optional aliased tool is missing', () => {
            const toolResolver = createMockToolResolver({
                availableTools: []
            });
            const check = new ToolAvailabilityCheck(toolResolver);

            const skill = createTestSkill({
                tools: {
                    aliases: { mkdir: 'copilot_createDirectory?' }  // ? = optional
                }
            });

            const result = check.check(skill, {});

            expect(result.ready).toBe(true);  // Optional doesn't block
            expect(result.missingTools).toHaveLength(1);
            expect(result.issues[0].severity).toBe('warning');
        });
    });

    describe('check - step tools validation', () => {
        it('validates tools referenced in step.tools array', () => {
            const toolResolver = createMockToolResolver({
                availableTools: ['skiller_createFile']
            });
            const check = new ToolAvailabilityCheck(toolResolver);

            const skill = createTestSkill({
                tools: { aliases: {} },
                steps: [
                    createTestStep({ tools: ['skiller_createFile', 'example_missingTool'] })
                ]
            });

            const result = check.check(skill, {});

            expect(result.ready).toBe(false);
            expect(result.issues.some(i => i.message.includes('example_missingTool'))).toBe(true);
        });

        it('validates tools referenced in step.tool (single tool step)', () => {
            const toolResolver = createMockToolResolver({
                availableTools: []
            });
            const check = new ToolAvailabilityCheck(toolResolver);

            const skill = createTestSkill({
                tools: { aliases: {} },
                steps: [
                    createTestStep({ type: 'tool', tool: 'example_missingTool' })
                ]
            });

            const result = check.check(skill, {});

            expect(result.ready).toBe(false);
            expect(result.issues[0].message).toContain('example_missingTool');
        });

        it('resolves step tool aliases', () => {
            const toolResolver = createMockToolResolver({
                availableTools: []
            });
            const check = new ToolAvailabilityCheck(toolResolver);

            const skill = createTestSkill({
                tools: {
                    aliases: { create: 'skiller_createFile' }
                },
                steps: [
                    createTestStep({ tools: ['create'] })
                ]
            });

            const result = check.check(skill, {});

            expect(result.ready).toBe(false);
            expect(result.missingTools[0].resolvedName).toBe('skiller_createFile');
        });
    });

    describe('check - severity based on ? suffix', () => {
        it('reports error for required tools (no ? suffix)', () => {
            const toolResolver = createMockToolResolver({ availableTools: [] });
            const check = new ToolAvailabilityCheck(toolResolver);

            const skill = createTestSkill({
                tools: {
                    aliases: { create: 'skiller_createFile' }  // No ? = required
                }
            });

            const result = check.check(skill, {});

            expect(result.ready).toBe(false);
            const issue = result.issues.find(i => i.message.includes('skiller_createFile'));
            expect(issue?.severity).toBe('error');
        });

        it('reports warning for optional tools (with ? suffix)', () => {
            const toolResolver = createMockToolResolver({ availableTools: [] });
            const check = new ToolAvailabilityCheck(toolResolver);

            const skill = createTestSkill({
                tools: {
                    aliases: { mkdir: 'copilot_createDirectory?' }  // ? = optional
                }
            });

            const result = check.check(skill, {});

            expect(result.ready).toBe(true); // Warnings don't block
            const issue = result.issues.find(i => i.message.includes('copilot_createDirectory'));
            expect(issue?.severity).toBe('warning');
        });
    });

    describe('check - deduplication', () => {
        it('does not report same missing tool twice', () => {
            const toolResolver = createMockToolResolver({ availableTools: [] });
            const check = new ToolAvailabilityCheck(toolResolver);

            const skill = createTestSkill({
                tools: {
                    aliases: { create: 'skiller_createFile' }
                },
                steps: [
                    createTestStep({ tools: ['create'] }), // Uses same alias
                    createTestStep({ tools: ['create'] })  // Uses same alias again
                ]
            });

            const result = check.check(skill, {});

            // Should only report skiller_createFile once (from alias + step deduped)
            const createFileIssues = result.issues.filter(i =>
                i.message.includes('skiller_createFile')
            );
            expect(createFileIssues.length).toBeLessThanOrEqual(1);
        });
    });
});

// ============================================================================
// ReadinessEngine Tests
// ============================================================================

describe('ReadinessEngine', () => {
    it('runs all registered checks', () => {
        const engine = new ReadinessEngine();
        const check1 = { id: 'check1', name: 'Check 1', check: vi.fn(() => ({ ready: true, issues: [] })) };
        const check2 = { id: 'check2', name: 'Check 2', check: vi.fn(() => ({ ready: true, issues: [] })) };

        engine.register(check1);
        engine.register(check2);

        const skill = createTestSkill();
        engine.checkReadiness(skill, {});

        expect(check1.check).toHaveBeenCalledTimes(1);
        expect(check2.check).toHaveBeenCalledTimes(1);
    });

    it('aggregates issues from all checks', () => {
        const engine = new ReadinessEngine();
        engine.register({
            id: 'check1',
            name: 'Check 1',
            check: () => ({
                ready: true,
                issues: [{ checkId: 'check1', severity: 'warning' as const, message: 'Warning 1' }]
            })
        });
        engine.register({
            id: 'check2',
            name: 'Check 2',
            check: () => ({
                ready: false,
                issues: [{ checkId: 'check2', severity: 'error' as const, message: 'Error 1' }]
            })
        });

        const result = engine.checkReadiness(createTestSkill(), {});

        expect(result.issues).toHaveLength(2);
        expect(result.errors).toHaveLength(1);
        expect(result.warnings).toHaveLength(1);
    });

    it('canRun is false if any check has errors', () => {
        const engine = new ReadinessEngine();
        engine.register({
            id: 'passing',
            name: 'Passing',
            check: () => ({ ready: true, issues: [] })
        });
        engine.register({
            id: 'failing',
            name: 'Failing',
            check: () => ({
                ready: false,
                issues: [{ checkId: 'failing', severity: 'error' as const, message: 'Error' }]
            })
        });

        const result = engine.checkReadiness(createTestSkill(), {});

        expect(result.canRun).toBe(false);
    });

    it('canRun is true when only warnings exist', () => {
        const engine = new ReadinessEngine();
        engine.register({
            id: 'warning-only',
            name: 'Warning Only',
            check: () => ({
                ready: true,
                issues: [{ checkId: 'warning-only', severity: 'warning' as const, message: 'Warning' }]
            })
        });

        const result = engine.checkReadiness(createTestSkill(), {});

        expect(result.canRun).toBe(true);
        expect(result.warnings).toHaveLength(1);
    });

    it('handles check throwing error gracefully', () => {
        const engine = new ReadinessEngine();
        engine.register({
            id: 'throws',
            name: 'Throws',
            check: () => { throw new Error('Check crashed!'); }
        });

        const result = engine.checkReadiness(createTestSkill(), {});

        expect(result.canRun).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain('crashed');
    });

    it('tracks duration', () => {
        const engine = new ReadinessEngine();
        engine.register({
            id: 'quick',
            name: 'Quick',
            check: () => ({ ready: true, issues: [] })
        });

        const result = engine.checkReadiness(createTestSkill(), {});

        expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('getCheckCount returns correct count', () => {
        const engine = new ReadinessEngine();
        expect(engine.getCheckCount()).toBe(0);

        engine.register({ id: 'a', name: 'A', check: () => ({ ready: true, issues: [] }) });
        expect(engine.getCheckCount()).toBe(1);

        engine.register({ id: 'b', name: 'B', check: () => ({ ready: true, issues: [] }) });
        expect(engine.getCheckCount()).toBe(2);
    });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory Functions', () => {
    beforeEach(() => {
        resetReadinessEngine();
    });

    describe('createReadinessEngine', () => {
        it('creates engine with default checks', () => {
            const engine = createReadinessEngine();
            expect(engine.getCheckCount()).toBe(1); // ToolAvailability only
        });
    });

    describe('formatReadinessResult', () => {
        it('formats success message', () => {
            const result = formatReadinessResult('test-skill', {
                canRun: true,
                issues: [],
                errors: [],
                warnings: [],
                duration: 5
            });

            expect(result).toContain('✅');
            expect(result).toContain('ready to run');
        });

        it('formats error messages', () => {
            const result = formatReadinessResult('test-skill', {
                canRun: false,
                issues: [{ checkId: 'test', severity: 'error', message: 'Missing tool X' }],
                errors: [{ checkId: 'test', severity: 'error', message: 'Missing tool X' }],
                warnings: [],
                duration: 5
            });

            expect(result).toContain('❌');
            expect(result).toContain('Missing tool X');
        });

        it('formats suggestions', () => {
            const result = formatReadinessResult('test-skill', {
                canRun: false,
                issues: [{
                    checkId: 'test',
                    severity: 'error',
                    message: 'Error',
                    suggestion: 'Try this fix'
                }],
                errors: [{
                    checkId: 'test',
                    severity: 'error',
                    message: 'Error',
                    suggestion: 'Try this fix'
                }],
                warnings: [],
                duration: 5
            });

            expect(result).toContain('💡');
            expect(result).toContain('Try this fix');
        });

        it('formats warnings separately', () => {
            const result = formatReadinessResult('test-skill', {
                canRun: true,
                issues: [{ checkId: 'test', severity: 'warning', message: 'Optional missing' }],
                errors: [],
                warnings: [{ checkId: 'test', severity: 'warning', message: 'Optional missing' }],
                duration: 5
            });

            expect(result).toContain('⚠️');
            expect(result).toContain('Optional missing');
        });
    });
});
