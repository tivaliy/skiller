/**
 * Tests for ExecutionStateEmitter — the execution state machine that the graph
 * panel subscribes to and that the executor/resume logic depends on.
 *
 * (Generation-guard / timer tests live in executor-resume.test.ts.)
 */

import { describe, it, expect, vi } from 'vitest';
import { ExecutionStateEmitter } from '../../../src/skills/execution-state';
import type { ExecutionEvent, StepInspection } from '../../../src/skills/execution-state';

function collect(es: ExecutionStateEmitter): ExecutionEvent[] {
    const events: ExecutionEvent[] = [];
    es.subscribe(e => events.push(e));
    return events;
}

describe('ExecutionStateEmitter', () => {
    describe('startExecution', () => {
        it('initializes steps as pending and terminals idle', () => {
            const es = new ExecutionStateEmitter();
            es.startExecution('s', ['a', 'b']);

            const state = es.getState('s')!;
            expect(state.steps.get('a')).toBe('pending');
            expect(state.steps.get('b')).toBe('pending');
            expect(state.terminals).toEqual({ start: 'idle', end: 'idle' });
            expect(state.currentStepId).toBeNull();
            expect(es.hasState('s')).toBe(true);
        });

        it('emits an execution:start event', () => {
            const es = new ExecutionStateEmitter();
            const events = collect(es);
            es.startExecution('s', ['a']);
            expect(events.some(e => e.type === 'execution:start' && e.skillId === 's')).toBe(true);
        });
    });

    describe('setStepStatus', () => {
        it('marks a step active and tracks it as current', () => {
            const es = new ExecutionStateEmitter();
            es.startExecution('s', ['a', 'b']);
            es.setStepStatus('s', 'a', 'active');

            const state = es.getState('s')!;
            expect(state.steps.get('a')).toBe('active');
            expect(state.currentStepId).toBe('a');
        });

        it('auto-completes the previous active step when a new step becomes active', () => {
            const es = new ExecutionStateEmitter();
            es.startExecution('s', ['a', 'b']);
            es.setStepStatus('s', 'a', 'active');
            const events = collect(es);
            es.setStepStatus('s', 'b', 'active');

            const state = es.getState('s')!;
            expect(state.steps.get('a')).toBe('completed');
            expect(state.steps.get('b')).toBe('active');
            expect(state.currentStepId).toBe('b');
            // The auto-complete of 'a' is emitted as its own event.
            expect(
                events.some(e => e.type === 'step:status' && e.stepId === 'a' && e.status === 'completed')
            ).toBe(true);
        });

        it('clears currentStepId when the current step leaves active', () => {
            const es = new ExecutionStateEmitter();
            es.startExecution('s', ['a']);
            es.setStepStatus('s', 'a', 'active');
            es.setStepStatus('s', 'a', 'completed');
            expect(es.getState('s')!.currentStepId).toBeNull();
        });

        it('records skipped and error statuses', () => {
            const es = new ExecutionStateEmitter();
            es.startExecution('s', ['a', 'b']);
            es.setStepStatus('s', 'a', 'skipped');
            es.setStepStatus('s', 'b', 'error');
            expect(es.getState('s')!.steps.get('a')).toBe('skipped');
            expect(es.getState('s')!.steps.get('b')).toBe('error');
        });

        it('stores per-step model info when provided', () => {
            const es = new ExecutionStateEmitter();
            es.startExecution('s', ['a']);
            es.setStepStatus('s', 'a', 'active', { model: { displayName: 'GPT-4o', source: 'skill-step' } });
            expect(es.getState('s')!.stepModels.get('a')).toEqual({ displayName: 'GPT-4o', source: 'skill-step' });
        });

        it('is a no-op for an unknown skill', () => {
            const es = new ExecutionStateEmitter();
            expect(() => es.setStepStatus('missing', 'a', 'active')).not.toThrow();
            expect(es.hasState('missing')).toBe(false);
        });
    });

    describe('terminals', () => {
        it('updates and emits terminal status', () => {
            const es = new ExecutionStateEmitter();
            es.startExecution('s', ['a']);
            const events = collect(es);
            es.setTerminalStatus('s', 'start', 'completed');
            expect(es.getState('s')!.terminals.start).toBe('completed');
            expect(events.some(e => e.type === 'terminal:status' && e.terminal === 'start')).toBe(true);
        });
    });

    describe('reset / resetAll', () => {
        it('reset returns all steps to pending and terminals to idle', () => {
            const es = new ExecutionStateEmitter();
            es.startExecution('s', ['a', 'b']);
            es.setStepStatus('s', 'a', 'completed');
            es.setTerminalStatus('s', 'end', 'completed');
            es.reset('s');

            const state = es.getState('s')!;
            expect(state.steps.get('a')).toBe('pending');
            expect(state.terminals).toEqual({ start: 'idle', end: 'idle' });
            expect(state.currentStepId).toBeNull();
        });

        it('resetAll resets every tracked skill', () => {
            const es = new ExecutionStateEmitter();
            es.startExecution('s1', ['a']);
            es.startExecution('s2', ['b']);
            es.setStepStatus('s1', 'a', 'completed');
            es.setStepStatus('s2', 'b', 'completed');
            es.resetAll();
            expect(es.getState('s1')!.steps.get('a')).toBe('pending');
            expect(es.getState('s2')!.steps.get('b')).toBe('pending');
        });
    });

    describe('subscribe', () => {
        it('stops delivering events after unsubscribe', () => {
            const es = new ExecutionStateEmitter();
            const listener = vi.fn();
            const unsubscribe = es.subscribe(listener);
            es.startExecution('s', ['a']);
            const countAfterFirst = listener.mock.calls.length;
            expect(countAfterFirst).toBeGreaterThan(0);

            unsubscribe();
            es.setStepStatus('s', 'a', 'active');
            expect(listener.mock.calls.length).toBe(countAfterFirst);
        });
    });

    describe('step inspection data', () => {
        const sample = (over: Partial<StepInspection> = {}): StepInspection => ({
            kind: 'llm',
            prompt: 'the prompt',
            response: 'the response',
            modelUsed: 'gpt-4o',
            toolsUsed: ['readFile'],
            durationMs: 5,
            status: 'completed',
            ...over
        });

        it('records and retrieves step inspection data', () => {
            const es = new ExecutionStateEmitter();
            es.startExecution('s', ['a']);
            es.recordStepInspection('s', 'a', sample());
            expect(es.getState('s')!.stepInspections.get('a')).toEqual(sample());
        });

        it('overwrites inspection data on re-record (loop: latest wins)', () => {
            const es = new ExecutionStateEmitter();
            es.startExecution('s', ['a']);
            es.recordStepInspection('s', 'a', sample({ prompt: 'first' }));
            es.recordStepInspection('s', 'a', sample({ prompt: 'second' }));
            expect(es.getState('s')!.stepInspections.get('a')!.prompt).toBe('second');
        });

        it('emits a step:inspection event for subscribers', () => {
            const es = new ExecutionStateEmitter();
            es.startExecution('s', ['a']);
            const events = collect(es);
            es.recordStepInspection('s', 'a', sample());
            expect(
                events.some(e => e.type === 'step:inspection' && e.skillId === 's' && e.stepId === 'a')
            ).toBe(true);
        });

        it('clears inspection data on reset', () => {
            const es = new ExecutionStateEmitter();
            es.startExecution('s', ['a']);
            es.recordStepInspection('s', 'a', sample());
            es.reset('s');
            expect(es.getState('s')!.stepInspections.size).toBe(0);
        });

        it('clears inspection data on resetAll', () => {
            const es = new ExecutionStateEmitter();
            es.startExecution('s1', ['a']);
            es.recordStepInspection('s1', 'a', sample());
            es.resetAll();
            expect(es.getState('s1')!.stepInspections.size).toBe(0);
        });

        it('is a no-op for an unknown skill', () => {
            const es = new ExecutionStateEmitter();
            expect(() => es.recordStepInspection('missing', 'a', sample())).not.toThrow();
            expect(es.hasState('missing')).toBe(false);
        });
    });
});
