/**
 * Tests for SkillExecutor resume behavior and execution-state generation guard.
 *
 * Covers:
 * - S-01: a backward `goto` / resume must not duplicate step results, must clear
 *   re-run outputs, and must reset graph status for the re-run window.
 * - S-08: the confirmation choice is recorded via the executor (recordOutput),
 *   not written by the command layer.
 * - S-12: a delayed completion animation must not fire onto a since-reset run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SkillExecutor } from '../../../src/skills/SkillExecutor';
import { StepHandlerRegistry } from '../../../src/skills/handlers';
import type { StepHandler, StepContext } from '../../../src/skills/handlers';
import { ExecutionStateEmitter } from '../../../src/skills/execution-state';
import type { ExecutionEvent } from '../../../src/skills/execution-state';
import { createModelResolver } from '../../../src/skills/model-resolver';
import type {
    Skill,
    SkillStep,
    ExecutionOptions,
    ExecutionContext,
    StepResult,
} from '../../../src/skills/types';

/**
 * Handler that records every step it runs and returns a deterministic output.
 * usesLLM is omitted (falsy) so the executor never touches the model resolver.
 */
function recordingHandler(runOrder: string[]): StepHandler {
    return {
        category: 'execution',
        handledStepTypes: ['llm'],
        usesLLM: false,
        canHandle: () => true,
        handle: async (ctx: StepContext) => {
            runOrder.push(ctx.step.id);
            return {
                action: 'continue',
                statusUpdate: 'completed',
                contextUpdates: { output: `out-${ctx.step.id}`, stepTime: 1 },
                stepResult: {
                    stepId: ctx.step.id,
                    success: true,
                    data: `out-${ctx.step.id}`,
                    duration: 1,
                },
            };
        },
    };
}

function makeSkill(stepIds: string[]): Skill {
    const steps: SkillStep[] = stepIds.map(id => ({
        id,
        type: 'llm',
        message: `inline ${id}`, // inline => no file IO in loadSkillSteps
        output: id,
    }));
    return {
        id: 'resume-skill',
        name: 'Resume Skill',
        description: 'test',
        version: '1.0.0',
        inputs: [],
        tools: { aliases: {} },
        steps,
        onError: 'continue',
        source: { type: 'builtin', path: '/mock/resume-skill' },
    };
}

function makeOptions(executionState: ExecutionStateEmitter): ExecutionOptions {
    return {
        inputs: {},
        // Model is never used because the handler declares no usesLLM.
        model: { id: 'test-model' } as unknown as ExecutionOptions['model'],
        isAutoMode: true,
        token: { isCancellationRequested: false } as unknown as ExecutionOptions['token'],
        stream: undefined,
        availableMcps: [],
        executionState,
    };
}

describe('SkillExecutor resume', () => {
    let executor: SkillExecutor;
    let executionState: ExecutionStateEmitter;
    let runOrder: string[];

    beforeEach(() => {
        runOrder = [];
        const registry = new StepHandlerRegistry();
        registry.register(recordingHandler(runOrder));
        executor = new SkillExecutor(registry, createModelResolver());
        executionState = new ExecutionStateEmitter();
    });

    it('does not duplicate step results when resuming (backward goto)', async () => {
        const skill = makeSkill(['a', 'b', 'c']);

        const first = await executor.execute(skill, makeOptions(executionState));
        expect(first.steps.map(s => s.stepId)).toEqual(['a', 'b', 'c']);

        // Resume from step index 1 (re-run b, c) — as a backward goto would.
        runOrder.length = 0;
        const resumed = await executor.execute(skill, makeOptions(executionState), {
            startFromStep: 1,
            existingContext: first.context,
            existingStepResults: first.steps,
        });

        // b and c re-ran; a was kept. No duplicates.
        expect(runOrder).toEqual(['b', 'c']);
        expect(resumed.steps.map(s => s.stepId)).toEqual(['a', 'b', 'c']);
        expect(resumed.steps).toHaveLength(3);
    });

    it('records the confirmation choice via recordOutput (single mutation point)', async () => {
        const skill = makeSkill(['a', 'review', 'c']);
        const first = await executor.execute(skill, makeOptions(executionState));

        const resumed = await executor.execute(skill, makeOptions(executionState), {
            startFromStep: 2,
            existingContext: first.context,
            existingStepResults: first.steps,
            recordOutput: { key: 'review', value: { action: 'continue' } },
        });

        expect(resumed.context.outputs.review).toEqual({ action: 'continue' });
    });

    it('marks the answered step completed on a forward resume (executor owns the transition)', async () => {
        const skill = makeSkill(['a', 'review', 'c']);
        const first = await executor.execute(skill, makeOptions(executionState));

        const events: ExecutionEvent[] = [];
        const unsubscribe = executionState.subscribe(e => events.push(e));

        await executor.execute(skill, makeOptions(executionState), {
            startFromStep: 2, // resume PAST 'review' (index 1) — it won't re-run
            existingContext: first.context,
            existingStepResults: first.steps,
            completedStepId: 'review',
        });
        unsubscribe();

        const reviewCompleted = events.some(
            e => e.type === 'step:status' && e.stepId === 'review' && e.status === 'completed'
        );
        expect(reviewCompleted).toBe(true);
    });

    it('resets (does not complete) the answered step when it falls in the re-run window (backward goto)', async () => {
        const skill = makeSkill(['a', 'review', 'c']);
        const first = await executor.execute(skill, makeOptions(executionState));

        const events: ExecutionEvent[] = [];
        const unsubscribe = executionState.subscribe(e => events.push(e));

        await executor.execute(skill, makeOptions(executionState), {
            startFromStep: 1, // re-run window INCLUDES 'review' (index 1)
            existingContext: first.context,
            existingStepResults: first.steps,
            completedStepId: 'review',
        });
        unsubscribe();

        // prepareResume must reset 'review' to pending (then it re-runs), not
        // short-circuit it to 'completed'.
        const reviewStatuses: string[] = [];
        for (const e of events) {
            if (e.type === 'step:status' && e.stepId === 'review') {
                reviewStatuses.push(e.status);
            }
        }
        expect(reviewStatuses[0]).toBe('pending');
    });

    it('resets graph status to pending for the re-run window', async () => {
        const skill = makeSkill(['a', 'b', 'c']);
        const first = await executor.execute(skill, makeOptions(executionState));

        const events: ExecutionEvent[] = [];
        const unsubscribe = executionState.subscribe(e => events.push(e));

        await executor.execute(skill, makeOptions(executionState), {
            startFromStep: 1,
            existingContext: first.context,
            existingStepResults: first.steps,
        });
        unsubscribe();

        // b and c were reset to 'pending' during resume preparation.
        const pendingResets = events.filter(
            e => e.type === 'step:status' && e.status === 'pending'
        );
        const resetIds = pendingResets.map(e => (e as { stepId: string }).stepId);
        expect(resetIds).toContain('b');
        expect(resetIds).toContain('c');
        expect(resetIds).not.toContain('a');
    });

    it('clears stale outputs for steps in the re-run window before they re-run', async () => {
        const skill = makeSkill(['a', 'b', 'c']);
        const first = await executor.execute(skill, makeOptions(executionState));
        expect(first.context.outputs).toMatchObject({ a: 'out-a', b: 'out-b', c: 'out-c' });

        // Tamper with an output, then resume — the executor should clear & recompute it.
        (first.context.outputs as Record<string, unknown>).c = 'STALE';
        const resumed = await executor.execute(skill, makeOptions(executionState), {
            startFromStep: 1,
            existingContext: first.context,
            existingStepResults: first.steps,
        });

        expect(resumed.context.outputs.c).toBe('out-c');
    });
});

describe('ExecutionStateEmitter generation guard (S-12)', () => {
    let es: ExecutionStateEmitter;

    beforeEach(() => {
        es = new ExecutionStateEmitter();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('completes the end terminal when the run is not reset', () => {
        es.startExecution('s', ['a']);
        es.finishExecution('s', true);
        vi.advanceTimersByTime(1300);
        expect(es.getState('s')?.terminals.end).toBe('completed');
    });

    it('does not complete the end terminal after a reset (no stale animation)', () => {
        es.startExecution('s', ['a']);
        es.finishExecution('s', true); // schedules the 1200ms completion
        es.reset('s'); // new generation invalidates the pending timer
        vi.advanceTimersByTime(1300);
        expect(es.getState('s')?.terminals.end).toBe('idle');
    });

    it('does not complete after a restart of the same skill', () => {
        es.startExecution('s', ['a']);
        es.finishExecution('s', true);
        es.startExecution('s', ['a']); // fresh run, fresh generation
        vi.advanceTimersByTime(1300);
        expect(es.getState('s')?.terminals.end).toBe('idle');
    });
});
