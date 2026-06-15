/**
 * Tests for step handlers
 *
 * Tests the Strategy pattern implementation for step execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    StepHandlerRegistry,
    createDefaultRegistry,
    ConfirmationStepHandler,
    ToolStepHandler,
    LLMStepHandler,
    buildHandlerResult
} from '../../../src/skills/handlers';
import type { StepHandler, StepContext, HandlerResult } from '../../../src/skills/handlers';
import type { SkillStep, StepType } from '../../../src/skills/types';
import type { ProgressHooks } from '../../../src/skills/progress-hooks';
import type { ToolResolver } from '../../../src/skills/tool-resolver';

// Mock executionState
vi.mock('../../../src/skills/execution-state', () => ({
    executionState: {
        setStepStatus: vi.fn()
    }
}));

// Mock step-runners
vi.mock('../../../src/skills/step-runners', () => ({
    executeLLMStep: vi.fn().mockResolvedValue({
        stepId: 'test-step',
        success: true,
        data: { result: 'test' },
        duration: 100
    }),
    executeToolStep: vi.fn().mockResolvedValue({
        stepId: 'test-step',
        success: true,
        data: { result: 'tool-result' },
        duration: 50
    })
}));

describe('StepHandlerRegistry', () => {
    let registry: StepHandlerRegistry;

    beforeEach(() => {
        registry = new StepHandlerRegistry();
    });

    describe('register', () => {
        it('adds handler to registry', () => {
            const mockHandler: StepHandler = {
                category: 'execution',
                handledStepTypes: ['llm'],
                usesLLM: true,
                canHandle: () => true,
                handle: async () => ({ action: 'continue' })
            };

            registry.register(mockHandler);
            expect(registry.getHandlers()).toHaveLength(1);
        });

        it('maintains registration order', () => {
            const handler1: StepHandler = {
                category: 'execution',
                handledStepTypes: ['llm'],
                usesLLM: true,
                canHandle: () => true,
                handle: async () => ({ action: 'continue' })
            };
            const handler2: StepHandler = {
                category: 'confirmation',
                handledStepTypes: ['confirmation'],
                usesLLM: false,
                canHandle: () => true,
                handle: async () => ({ action: 'continue' })
            };

            registry.register(handler1);
            registry.register(handler2);

            const handlers = registry.getHandlers();
            expect(handlers[0].category).toBe('execution');
            expect(handlers[1].category).toBe('confirmation');
        });
    });

    describe('registerFirst', () => {
        it('adds handler at beginning', () => {
            const handler1: StepHandler = {
                category: 'execution',
                handledStepTypes: ['llm'],
                usesLLM: true,
                canHandle: () => true,
                handle: async () => ({ action: 'continue' })
            };
            const handler2: StepHandler = {
                category: 'confirmation',
                handledStepTypes: ['confirmation'],
                usesLLM: false,
                canHandle: () => true,
                handle: async () => ({ action: 'continue' })
            };

            registry.register(handler1);
            registry.registerFirst(handler2);

            const handlers = registry.getHandlers();
            expect(handlers[0].category).toBe('confirmation');
            expect(handlers[1].category).toBe('execution');
        });
    });

    describe('findHandler', () => {
        it('returns first matching handler', () => {
            const specificHandler: StepHandler = {
                category: 'confirmation',
                handledStepTypes: ['confirmation'],
                usesLLM: false,
                canHandle: (step) => step.type === 'confirmation',
                handle: async () => ({ action: 'continue' })
            };
            const defaultHandler: StepHandler = {
                category: 'execution',
                handledStepTypes: ['llm'],
                usesLLM: true,
                canHandle: () => true,
                handle: async () => ({ action: 'continue' })
            };

            registry.register(specificHandler);
            registry.register(defaultHandler);

            const confirmStep: SkillStep = { id: 'test', type: 'confirmation' };
            const llmStep: SkillStep = { id: 'test', type: 'llm' };

            expect(registry.findHandler(confirmStep)?.category).toBe('confirmation');
            expect(registry.findHandler(llmStep)?.category).toBe('execution');
        });

        it('returns undefined when no handler matches', () => {
            const handler: StepHandler = {
                category: 'confirmation',
                handledStepTypes: ['confirmation'],
                usesLLM: false,
                canHandle: (step) => step.type === 'confirmation',
                handle: async () => ({ action: 'continue' })
            };

            registry.register(handler);

            const step: SkillStep = { id: 'test', type: 'llm' };
            expect(registry.findHandler(step)).toBeUndefined();
        });
    });

    describe('hasHandlerCategory', () => {
        it('returns true if handler category is registered', () => {
            const handler: StepHandler = {
                category: 'confirmation',
                handledStepTypes: ['confirmation'],
                usesLLM: false,
                canHandle: () => true,
                handle: async () => ({ action: 'continue' })
            };

            registry.register(handler);
            expect(registry.hasHandlerCategory('confirmation')).toBe(true);
            expect(registry.hasHandlerCategory('execution')).toBe(false);
        });
    });

    describe('hasHandlerForStepType', () => {
        it('returns true if handler for step type is registered', () => {
            const handler: StepHandler = {
                category: 'execution',
                handledStepTypes: ['llm', 'tool'],
                usesLLM: true,
                canHandle: () => true,
                handle: async () => ({ action: 'continue' })
            };

            registry.register(handler);
            expect(registry.hasHandlerForStepType('llm')).toBe(true);
            expect(registry.hasHandlerForStepType('tool')).toBe(true);
            expect(registry.hasHandlerForStepType('confirmation')).toBe(false);
        });
    });

    describe('getHandledStepTypes', () => {
        it('returns all step types handled by registered handlers', () => {
            const handler1: StepHandler = {
                category: 'confirmation',
                handledStepTypes: ['confirmation'],
                usesLLM: false,
                canHandle: () => true,
                handle: async () => ({ action: 'continue' })
            };
            const handler2: StepHandler = {
                category: 'execution',
                handledStepTypes: ['llm', 'tool'],
                usesLLM: true,
                canHandle: () => true,
                handle: async () => ({ action: 'continue' })
            };

            registry.register(handler1);
            registry.register(handler2);

            const types = registry.getHandledStepTypes();
            expect(types).toContain('confirmation');
            expect(types).toContain('llm');
            expect(types).toContain('tool');
            expect(types).toHaveLength(3);
        });
    });
});

describe('createDefaultRegistry', () => {
    it('creates registry with confirmation, tool, and llm handlers', () => {
        const registry = createDefaultRegistry();
        const handlers = registry.getHandlers();

        expect(handlers).toHaveLength(3);
        expect(registry.hasHandlerCategory('confirmation')).toBe(true);
        expect(registry.hasHandlerCategory('execution')).toBe(true);
    });

    it('creates fresh registry each time (no shared state)', () => {
        const registry1 = createDefaultRegistry();
        const registry2 = createDefaultRegistry();

        // They should be different instances
        expect(registry1).not.toBe(registry2);
        expect(registry1.getHandlers()).not.toBe(registry2.getHandlers());
    });

    it('finds confirmation handler for confirmation steps', () => {
        const registry = createDefaultRegistry();
        const step: SkillStep = { id: 'test', type: 'confirmation' };

        const handler = registry.findHandler(step);
        expect(handler?.category).toBe('confirmation');
    });

    it('finds execution handler for non-confirmation steps', () => {
        const registry = createDefaultRegistry();

        const llmStep: SkillStep = { id: 'test', type: 'llm' };
        const toolStep: SkillStep = { id: 'test', type: 'tool' };

        expect(registry.findHandler(llmStep)?.category).toBe('execution');
        expect(registry.findHandler(toolStep)?.category).toBe('execution');
    });

    it('returns undefined for step with no type (type is now required)', () => {
        const registry = createDefaultRegistry();
        const stepWithNoType: SkillStep = { id: 'test' };

        // Since type is now required, steps without explicit type should not find a handler
        expect(registry.findHandler(stepWithNoType)).toBeUndefined();
    });

    it('handles all defined step types', () => {
        const registry = createDefaultRegistry();
        const types = registry.getHandledStepTypes();

        expect(types).toContain('confirmation');
        expect(types).toContain('llm');
        expect(types).toContain('tool');
    });
});

describe('ConfirmationStepHandler', () => {
    let handler: ConfirmationStepHandler;

    beforeEach(() => {
        handler = new ConfirmationStepHandler();
    });

    describe('canHandle', () => {
        it('returns true for confirmation type', () => {
            const step: SkillStep = { id: 'test', type: 'confirmation' };
            expect(handler.canHandle(step)).toBe(true);
        });

        it('returns false for other types', () => {
            expect(handler.canHandle({ id: 'test', type: 'llm' })).toBe(false);
            expect(handler.canHandle({ id: 'test', type: 'tool' })).toBe(false);
            expect(handler.canHandle({ id: 'test' })).toBe(false);
        });
    });

    describe('category', () => {
        it('is confirmation', () => {
            expect(handler.category).toBe('confirmation');
        });
    });

    describe('handledStepTypes', () => {
        it('includes confirmation', () => {
            expect(handler.handledStepTypes).toContain('confirmation');
            expect(handler.handledStepTypes).toHaveLength(1);
        });
    });
});

describe('ToolStepHandler', () => {
    let handler: ToolStepHandler;

    beforeEach(() => {
        handler = new ToolStepHandler();
    });

    describe('canHandle', () => {
        it('returns true for tool type', () => {
            expect(handler.canHandle({ id: 'test', type: 'tool' })).toBe(true);
        });

        it('returns false for other types', () => {
            expect(handler.canHandle({ id: 'test', type: 'llm' })).toBe(false);
            expect(handler.canHandle({ id: 'test', type: 'confirmation' })).toBe(false);
            expect(handler.canHandle({ id: 'test' })).toBe(false);
        });
    });

    describe('category', () => {
        it('is execution', () => {
            expect(handler.category).toBe('execution');
        });
    });

    describe('handledStepTypes', () => {
        it('includes tool', () => {
            expect(handler.handledStepTypes).toContain('tool');
            expect(handler.handledStepTypes).toHaveLength(1);
        });
    });

    describe('handle (DI seam, S-19)', () => {
        it('routes the runner tool lookup through the INJECTED resolver, not the live API', async () => {
            // Resolver reports the tool as a valid reference, but its runtime
            // findTool returns undefined. The runner must consult THIS findTool
            // (pre-fix it used findMcpTool / vscode.lm and never the injected one).
            const findTool = vi.fn(() => undefined);
            const fakeResolver = {
                resolve: () => [],
                findTool,
                validateReferences: () => ({
                    valid: true,
                    resolved: [{ toolName: 'fake_tool', optional: false }],
                    missing: []
                })
            } as unknown as ToolResolver;

            const h = new ToolStepHandler(fakeResolver);
            const ctx = {
                skill: { tools: { aliases: {} }, onError: 'continue' },
                step: { id: 's1', type: 'tool', tool: 'fake_tool' },
                context: {},
                token: { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
                toolToken: undefined
            } as unknown as StepContext;

            const result = await h.handle(ctx, {});

            expect(findTool).toHaveBeenCalledWith('fake_tool');
            // Lookup went through the fake (which returns undefined) → not found,
            // proving the runner did not silently fall back to the live API.
            expect(result.stepResult?.success).toBe(false);
            expect(result.stepResult?.error).toContain('Tool not found');
        });
    });
});

describe('LLMStepHandler', () => {
    let handler: LLMStepHandler;

    beforeEach(() => {
        handler = new LLMStepHandler();
    });

    describe('canHandle', () => {
        it('returns true for llm type', () => {
            expect(handler.canHandle({ id: 'test', type: 'llm' })).toBe(true);
        });

        it('returns false for undefined type (type is now required)', () => {
            // Since type is now required, undefined type should not be handled by LLM handler
            expect(handler.canHandle({ id: 'test' })).toBe(false);
        });

        it('returns false for other types', () => {
            expect(handler.canHandle({ id: 'test', type: 'tool' })).toBe(false);
            expect(handler.canHandle({ id: 'test', type: 'confirmation' })).toBe(false);
        });
    });

    describe('category', () => {
        it('is execution', () => {
            expect(handler.category).toBe('execution');
        });
    });

    describe('handledStepTypes', () => {
        it('includes llm', () => {
            expect(handler.handledStepTypes).toContain('llm');
            expect(handler.handledStepTypes).toHaveLength(1);
        });
    });
});

// Minimal StepContext stub - buildHandlerResult only uses ctx.skill.onError and ctx.step.output
function makeCtx(onError: 'abort' | 'continue', outputKey?: string): StepContext {
    return {
        skill: { onError } as unknown,
        step: { id: 'test-step', output: outputKey } as unknown,
    } as StepContext;
}

describe('buildHandlerResult', () => {
    it('stores output on successful step', () => {
        const ctx = makeCtx('continue', 'my_output');
        const stepResult = { stepId: 'test-step', success: true, data: { value: 42 }, duration: 100 };

        const result = buildHandlerResult(ctx, stepResult);

        expect(result.contextUpdates?.output).toEqual({ value: 42 });
    });

    it('stores output on failed step when LLM produced diagnostic data', () => {
        const ctx = makeCtx('continue', 'my_output');
        const stepResult = {
            stepId: 'test-step',
            success: false,
            data: { success: false, error: 'File not found or empty' },
            duration: 100
        };

        const result = buildHandlerResult(ctx, stepResult);

        // Guard steps (when: outputs.X.success != true) depend on this being set
        expect(result.contextUpdates?.output).toEqual({ success: false, error: 'File not found or empty' });
    });

    it('does not store output when data is undefined', () => {
        const ctx = makeCtx('continue', 'my_output');
        const stepResult = { stepId: 'test-step', success: false, duration: 100 };

        const result = buildHandlerResult(ctx, stepResult);

        expect(result.contextUpdates?.output).toBeUndefined();
    });

    it('does not store output when step has no output key', () => {
        const ctx = makeCtx('continue'); // no output key
        const stepResult = { stepId: 'test-step', success: true, data: { value: 42 }, duration: 100 };

        const result = buildHandlerResult(ctx, stepResult);

        expect(result.contextUpdates?.output).toBeUndefined();
    });

    it('returns abort action when step fails and skill on_error is abort', () => {
        const ctx = makeCtx('abort');
        const stepResult = { stepId: 'test-step', success: false, error: 'failed', duration: 100 };

        const result = buildHandlerResult(ctx, stepResult);

        expect(result.action).toBe('return');
    });

    it('returns continue action when step fails and skill on_error is continue', () => {
        const ctx = makeCtx('continue');
        const stepResult = { stepId: 'test-step', success: false, error: 'failed', duration: 100 };

        const result = buildHandlerResult(ctx, stepResult);

        expect(result.action).toBe('continue');
    });
});

describe('HandlerResult', () => {
    describe('contextUpdates', () => {
        it('can include output value', () => {
            const result: HandlerResult = {
                action: 'continue',
                stepResult: { stepId: 'test', success: true, duration: 100 },
                contextUpdates: {
                    output: { result: 'data' },
                    stepTime: 100
                }
            };

            expect(result.contextUpdates?.output).toEqual({ result: 'data' });
            expect(result.contextUpdates?.stepTime).toBe(100);
        });

        it('can be undefined', () => {
            const result: HandlerResult = {
                action: 'continue',
                stepResult: { stepId: 'test', success: true, duration: 100 }
            };

            expect(result.contextUpdates).toBeUndefined();
        });
    });

    describe('reportCompletion', () => {
        it('defaults to true (executor reports completion)', () => {
            const result: HandlerResult = {
                action: 'continue',
                stepResult: { stepId: 'test', success: true, duration: 100 }
            };

            // undefined means default (true)
            expect(result.reportCompletion).toBeUndefined();
        });

        it('can be set to false for special steps', () => {
            const result: HandlerResult = {
                action: 'return',
                stepResult: { stepId: 'test', success: true, duration: 100 },
                reportCompletion: false
            };

            expect(result.reportCompletion).toBe(false);
        });
    });
});
