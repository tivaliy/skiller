/**
 * Tests for PendingStateManager class
 *
 * Tests skill execution state management for confirmations and input collection.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PendingStateManager } from '../../../src/skills/PendingStateManager';
import {
    Skill,
    SkillInput,
    ExecutionContext,
    ConfirmationOption,
    StepResult,
    ExecutionOptions
} from '../../../src/skills/types';

/**
 * Create a minimal mock skill for testing
 */
function createMockSkill(id: string = 'test-skill'): Skill {
    return {
        id,
        name: 'Test Skill',
        description: 'A test skill',
        version: '1.0.0',
        inputs: [],
        tools: { aliases: {} },
        steps: [
            {
                id: 'step1',
                type: 'tool',
                tool: 'test_tool',
                params: {}
            }
        ],
        onError: 'continue',
        source: { type: 'builtin', path: '/mock/test-skill' }
    };
}

/**
 * Create a mock execution context
 */
function createMockContext(): ExecutionContext {
    return {
        inputs: {},
        outputs: {},
        currentStep: 0,
        totalSteps: 1,
        skill: createMockSkill(),
        startTime: 0,
        stepTimes: {},
        availableMcps: []
    };
}

/**
 * Create mock confirmation options
 */
function createMockOptions(): ConfirmationOption[] {
    return [
        { label: 'Continue', action: 'continue' },
        { label: 'Cancel', action: 'abort' }
    ];
}

/**
 * Create mock step results
 */
function createMockStepResults(): StepResult[] {
    return [
        { stepId: 'step1', success: true, data: { result: 'test' }, duration: 1 }
    ];
}

/**
 * Create a mock skill input
 */
function createMockInput(name: string, prompt: string = 'Enter value'): SkillInput {
    return {
        name,
        prompt,
        description: `${name} input`,
        type: 'string',
        required: true
    };
}

/**
 * Create mock execution options (everything except `inputs`, which the manager strips).
 *
 * `model`, `token`, and `executionState` are opaque fakes — the manager only stores
 * and returns the options object, it never inspects these fields.
 */
function createMockExecutionOptions(
    overrides: Partial<Omit<ExecutionOptions, 'inputs'>> = {}
): Omit<ExecutionOptions, 'inputs'> {
    return {
        model: { id: 'test-model' } as unknown as ExecutionOptions['model'],
        isAutoMode: true,
        token: { isCancellationRequested: false } as unknown as ExecutionOptions['token'],
        availableMcps: [],
        executionState: {} as unknown as ExecutionOptions['executionState'],
        ...overrides
    };
}

describe('PendingStateManager', () => {
    let manager: PendingStateManager;

    beforeEach(() => {
        manager = new PendingStateManager();
    });

    describe('confirmation state', () => {
        describe('setPendingConfirmation', () => {
            it('sets pending confirmation state', () => {
                const skill = createMockSkill();
                const context = createMockContext();
                const options = createMockOptions();
                const stepResults = createMockStepResults();
                const executionOptions = createMockExecutionOptions();

                manager.setPendingConfirmation(
                    skill,
                    context,
                    0,
                    options,
                    stepResults,
                    executionOptions
                );

                expect(manager.hasPendingConfirmation()).toBe(true);
            });

            it('overwrites previous pending confirmation', () => {
                const skill1 = createMockSkill('skill-1');
                const skill2 = createMockSkill('skill-2');
                const context = createMockContext();
                const options = createMockOptions();
                const stepResults = createMockStepResults();
                const executionOptions = createMockExecutionOptions();

                manager.setPendingConfirmation(skill1, context, 0, options, stepResults, executionOptions);
                manager.setPendingConfirmation(skill2, context, 1, options, stepResults, executionOptions);

                const pending = manager.getPendingConfirmation();
                expect(pending?.skillId).toBe('skill-2');
                expect(pending?.pendingStepIndex).toBe(1);
            });
        });

        describe('getPendingConfirmation', () => {
            it('returns null when no pending confirmation', () => {
                expect(manager.getPendingConfirmation()).toBeNull();
            });

            it('returns the pending confirmation state', () => {
                const skill = createMockSkill();
                const context = createMockContext();
                const options = createMockOptions();
                const stepResults = createMockStepResults();
                const executionOptions = createMockExecutionOptions();

                manager.setPendingConfirmation(skill, context, 2, options, stepResults, executionOptions);

                const pending = manager.getPendingConfirmation();
                expect(pending).not.toBeNull();
                expect(pending?.skillId).toBe('test-skill');
                expect(pending?.pendingStepIndex).toBe(2);
                expect(pending?.options).toEqual(options);
                expect(pending?.stepResults).toEqual(stepResults);
            });
        });

        describe('getPendingExecutionOptions', () => {
            it('returns null when no pending confirmation', () => {
                expect(manager.getPendingExecutionOptions()).toBeNull();
            });

            it('returns execution options from pending confirmation', () => {
                const skill = createMockSkill();
                const context = createMockContext();
                const options = createMockOptions();
                const stepResults = createMockStepResults();
                const executionOptions = createMockExecutionOptions({
                    isAutoMode: false,
                    verboseMode: 'raw'
                });

                manager.setPendingConfirmation(skill, context, 0, options, stepResults, executionOptions);

                const result = manager.getPendingExecutionOptions();
                expect(result).toEqual(executionOptions);
            });
        });

        describe('clearPendingConfirmation', () => {
            it('clears pending confirmation state', () => {
                const skill = createMockSkill();
                const context = createMockContext();
                const options = createMockOptions();
                const stepResults = createMockStepResults();
                const executionOptions = createMockExecutionOptions();

                manager.setPendingConfirmation(skill, context, 0, options, stepResults, executionOptions);
                expect(manager.hasPendingConfirmation()).toBe(true);

                manager.clearPendingConfirmation();
                expect(manager.hasPendingConfirmation()).toBe(false);
                expect(manager.getPendingConfirmation()).toBeNull();
            });

            it('is safe to call when no pending state', () => {
                expect(() => manager.clearPendingConfirmation()).not.toThrow();
            });
        });

        describe('hasPendingConfirmation', () => {
            it('returns false initially', () => {
                expect(manager.hasPendingConfirmation()).toBe(false);
            });

            it('returns true when confirmation is pending', () => {
                const skill = createMockSkill();
                const context = createMockContext();
                const options = createMockOptions();
                const stepResults = createMockStepResults();
                const executionOptions = createMockExecutionOptions();

                manager.setPendingConfirmation(skill, context, 0, options, stepResults, executionOptions);
                expect(manager.hasPendingConfirmation()).toBe(true);
            });

            it('returns false after clearing', () => {
                const skill = createMockSkill();
                const context = createMockContext();
                const options = createMockOptions();
                const stepResults = createMockStepResults();
                const executionOptions = createMockExecutionOptions();

                manager.setPendingConfirmation(skill, context, 0, options, stepResults, executionOptions);
                manager.clearPendingConfirmation();
                expect(manager.hasPendingConfirmation()).toBe(false);
            });
        });

        describe('createResumeOptions', () => {
            it('returns null when no pending confirmation', () => {
                expect(manager.createResumeOptions(1)).toBeNull();
            });

            it('creates resume options from pending state', () => {
                const skill = createMockSkill();
                const context = createMockContext();
                context.inputs = { issueKey: 'TEST-123' };
                const options = createMockOptions();
                const stepResults = createMockStepResults();
                const executionOptions = createMockExecutionOptions();

                manager.setPendingConfirmation(skill, context, 0, options, stepResults, executionOptions);

                const resumeOptions = manager.createResumeOptions(1);
                expect(resumeOptions).not.toBeNull();
                expect(resumeOptions?.startFromStep).toBe(1);
                expect(resumeOptions?.existingContext).toBe(context);
                expect(resumeOptions?.existingStepResults).toBe(stepResults);
            });

            it('allows specifying different start step', () => {
                const skill = createMockSkill();
                const context = createMockContext();
                const options = createMockOptions();
                const stepResults = createMockStepResults();
                const executionOptions = createMockExecutionOptions();

                manager.setPendingConfirmation(skill, context, 2, options, stepResults, executionOptions);

                const resumeOptions = manager.createResumeOptions(3);
                expect(resumeOptions?.startFromStep).toBe(3);
            });
        });
    });

    describe('input collection state', () => {
        describe('setPendingInputCollection', () => {
            it('sets pending input collection state', () => {
                const skill = createMockSkill();
                const currentInput = createMockInput('issueKey', 'Enter issue key');
                const remainingInputs = [createMockInput('summary')];

                manager.setPendingInputCollection(
                    skill,
                    {},
                    currentInput,
                    remainingInputs
                );

                expect(manager.hasPendingInputCollection()).toBe(true);
            });

            it('stores collected inputs', () => {
                const skill = createMockSkill();
                const collectedInputs = { name: 'John', age: 30 };
                const currentInput = createMockInput('email');
                const remainingInputs: SkillInput[] = [];

                manager.setPendingInputCollection(skill, collectedInputs, currentInput, remainingInputs);

                const pending = manager.getPendingInputCollection();
                expect(pending?.collectedInputs).toEqual({ name: 'John', age: 30 });
            });
        });

        describe('getPendingInputCollection', () => {
            it('returns null when no pending input collection', () => {
                expect(manager.getPendingInputCollection()).toBeNull();
            });

            it('returns the pending input collection state', () => {
                const skill = createMockSkill('input-skill');
                const currentInput = createMockInput('issueKey', 'Enter issue key');
                const remainingInputs = [createMockInput('summary'), createMockInput('description')];

                manager.setPendingInputCollection(skill, {}, currentInput, remainingInputs);

                const pending = manager.getPendingInputCollection();
                expect(pending).not.toBeNull();
                expect(pending?.skillId).toBe('input-skill');
                expect(pending?.currentInput.name).toBe('issueKey');
                expect(pending?.remainingInputs).toHaveLength(2);
            });
        });

        describe('clearPendingInputCollection', () => {
            it('clears pending input collection state', () => {
                const skill = createMockSkill();
                const currentInput = createMockInput('test');

                manager.setPendingInputCollection(skill, {}, currentInput, []);
                expect(manager.hasPendingInputCollection()).toBe(true);

                manager.clearPendingInputCollection();
                expect(manager.hasPendingInputCollection()).toBe(false);
            });

            it('is safe to call when no pending state', () => {
                expect(() => manager.clearPendingInputCollection()).not.toThrow();
            });
        });

        describe('hasPendingInputCollection', () => {
            it('returns false initially', () => {
                expect(manager.hasPendingInputCollection()).toBe(false);
            });

            it('returns true when input collection is pending', () => {
                const skill = createMockSkill();
                const currentInput = createMockInput('test');

                manager.setPendingInputCollection(skill, {}, currentInput, []);
                expect(manager.hasPendingInputCollection()).toBe(true);
            });
        });

        describe('addCollectedInput', () => {
            it('returns null when no pending input collection', () => {
                expect(manager.addCollectedInput('test', 'value')).toBeNull();
            });

            it('adds value to collected inputs', () => {
                const skill = createMockSkill();
                const currentInput = createMockInput('issueKey');
                const nextInput = createMockInput('summary');

                manager.setPendingInputCollection(skill, {}, currentInput, [nextInput]);
                manager.addCollectedInput('issueKey', 'TEST-123');

                const collected = manager.getCollectedInputs();
                expect(collected.issueKey).toBe('TEST-123');
            });

            it('returns next input when more inputs remain', () => {
                const skill = createMockSkill();
                const input1 = createMockInput('first');
                const input2 = createMockInput('second');
                const input3 = createMockInput('third');

                manager.setPendingInputCollection(skill, {}, input1, [input2, input3]);

                const nextInput = manager.addCollectedInput('first', 'value1');
                expect(nextInput?.name).toBe('second');
            });

            it('returns null when no more inputs remain', () => {
                const skill = createMockSkill();
                const currentInput = createMockInput('only');

                manager.setPendingInputCollection(skill, {}, currentInput, []);

                const nextInput = manager.addCollectedInput('only', 'value');
                expect(nextInput).toBeNull();
            });

            it('updates currentInput to the next input', () => {
                const skill = createMockSkill();
                const input1 = createMockInput('first');
                const input2 = createMockInput('second');

                manager.setPendingInputCollection(skill, {}, input1, [input2]);
                manager.addCollectedInput('first', 'value1');

                const pending = manager.getPendingInputCollection();
                expect(pending?.currentInput.name).toBe('second');
            });

            it('removes used input from remainingInputs', () => {
                const skill = createMockSkill();
                const input1 = createMockInput('first');
                const input2 = createMockInput('second');
                const input3 = createMockInput('third');

                manager.setPendingInputCollection(skill, {}, input1, [input2, input3]);
                manager.addCollectedInput('first', 'value1');

                const pending = manager.getPendingInputCollection();
                expect(pending?.remainingInputs).toHaveLength(1);
                expect(pending?.remainingInputs[0].name).toBe('third');
            });

            it('collects multiple inputs sequentially', () => {
                const skill = createMockSkill();
                const input1 = createMockInput('first');
                const input2 = createMockInput('second');
                const input3 = createMockInput('third');

                manager.setPendingInputCollection(skill, {}, input1, [input2, input3]);

                manager.addCollectedInput('first', 'value1');
                manager.addCollectedInput('second', 'value2');
                manager.addCollectedInput('third', 'value3');

                const collected = manager.getCollectedInputs();
                expect(collected).toEqual({
                    first: 'value1',
                    second: 'value2',
                    third: 'value3'
                });
            });
        });

        describe('getCollectedInputs', () => {
            it('returns empty object when no pending state', () => {
                expect(manager.getCollectedInputs()).toEqual({});
            });

            it('returns collected inputs from pending state', () => {
                const skill = createMockSkill();
                const currentInput = createMockInput('next');
                const collectedInputs = { previous: 'value' };

                manager.setPendingInputCollection(skill, collectedInputs, currentInput, []);

                expect(manager.getCollectedInputs()).toEqual({ previous: 'value' });
            });
        });
    });

    describe('combined operations', () => {
        describe('clearAllPendingState', () => {
            it('returns false when no pending state', () => {
                expect(manager.clearAllPendingState()).toBe(false);
            });

            it('clears confirmation state and returns true', () => {
                const skill = createMockSkill();
                const context = createMockContext();
                const options = createMockOptions();
                const stepResults = createMockStepResults();
                const executionOptions = createMockExecutionOptions();

                manager.setPendingConfirmation(skill, context, 0, options, stepResults, executionOptions);

                expect(manager.clearAllPendingState()).toBe(true);
                expect(manager.hasPendingConfirmation()).toBe(false);
            });

            it('clears input collection state and returns true', () => {
                const skill = createMockSkill();
                const currentInput = createMockInput('test');

                manager.setPendingInputCollection(skill, {}, currentInput, []);

                expect(manager.clearAllPendingState()).toBe(true);
                expect(manager.hasPendingInputCollection()).toBe(false);
            });

            it('clears both states and returns true', () => {
                const skill = createMockSkill();
                const context = createMockContext();
                const options = createMockOptions();
                const stepResults = createMockStepResults();
                const executionOptions = createMockExecutionOptions();
                const currentInput = createMockInput('test');

                manager.setPendingConfirmation(skill, context, 0, options, stepResults, executionOptions);
                manager.setPendingInputCollection(skill, {}, currentInput, []);

                expect(manager.clearAllPendingState()).toBe(true);
                expect(manager.hasPendingConfirmation()).toBe(false);
                expect(manager.hasPendingInputCollection()).toBe(false);
            });

            it('returns false on second call after clearing', () => {
                const skill = createMockSkill();
                const currentInput = createMockInput('test');

                manager.setPendingInputCollection(skill, {}, currentInput, []);
                manager.clearAllPendingState();

                expect(manager.clearAllPendingState()).toBe(false);
            });
        });

        describe('independent state management', () => {
            it('confirmation and input collection are independent', () => {
                const skill = createMockSkill();
                const context = createMockContext();
                const options = createMockOptions();
                const stepResults = createMockStepResults();
                const executionOptions = createMockExecutionOptions();
                const currentInput = createMockInput('test');

                manager.setPendingConfirmation(skill, context, 0, options, stepResults, executionOptions);
                manager.setPendingInputCollection(skill, {}, currentInput, []);

                expect(manager.hasPendingConfirmation()).toBe(true);
                expect(manager.hasPendingInputCollection()).toBe(true);

                manager.clearPendingConfirmation();

                expect(manager.hasPendingConfirmation()).toBe(false);
                expect(manager.hasPendingInputCollection()).toBe(true);
            });

            it('clearing one does not affect the other', () => {
                const skill = createMockSkill();
                const currentInput = createMockInput('test');
                const context = createMockContext();
                const options = createMockOptions();
                const stepResults = createMockStepResults();
                const executionOptions = createMockExecutionOptions();

                manager.setPendingInputCollection(skill, {}, currentInput, []);
                manager.setPendingConfirmation(skill, context, 0, options, stepResults, executionOptions);

                manager.clearPendingInputCollection();

                expect(manager.hasPendingInputCollection()).toBe(false);
                expect(manager.hasPendingConfirmation()).toBe(true);
            });
        });
    });

    describe('edge cases', () => {
        it('handles empty remaining inputs array', () => {
            const skill = createMockSkill();
            const currentInput = createMockInput('only');

            manager.setPendingInputCollection(skill, {}, currentInput, []);

            const pending = manager.getPendingInputCollection();
            expect(pending?.remainingInputs).toEqual([]);
        });

        it('handles complex input values', () => {
            const skill = createMockSkill();
            const currentInput = createMockInput('data');

            manager.setPendingInputCollection(skill, {}, currentInput, []);
            manager.addCollectedInput('data', { nested: { value: [1, 2, 3] } });

            const collected = manager.getCollectedInputs();
            expect(collected.data).toEqual({ nested: { value: [1, 2, 3] } });
        });

        it('handles null input values', () => {
            const skill = createMockSkill();
            const currentInput = createMockInput('nullable');

            manager.setPendingInputCollection(skill, {}, currentInput, []);
            manager.addCollectedInput('nullable', null);

            const collected = manager.getCollectedInputs();
            expect(collected.nullable).toBeNull();
        });

        it('handles undefined input values', () => {
            const skill = createMockSkill();
            const currentInput = createMockInput('optional');

            manager.setPendingInputCollection(skill, {}, currentInput, []);
            manager.addCollectedInput('optional', undefined);

            const collected = manager.getCollectedInputs();
            expect(collected.optional).toBeUndefined();
        });
    });
});
