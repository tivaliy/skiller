/**
 * RunController drives one skill run end to end through the real engine
 * (SkillExecutor + handlers) and talks to the user only through the RunSurface
 * port — here a FakeSurface that records calls and answers from a script.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CancellationToken } from 'vscode';
import { RunController } from '../../../../src/skills/run/controller';
import type { RunControllerDeps } from '../../../../src/skills/run/controller';
import { ToolApprovalPolicy } from '../../../../src/skills/run/tool-approvals';
import type { RunSurface, ToolApproval, ToolCallRequest } from '../../../../src/skills/run/types';
import { SkillExecutor } from '../../../../src/skills/SkillExecutor';
import { StepHandlerRegistry, ConfirmationStepHandler } from '../../../../src/skills/handlers';
import type { StepHandler, StepContext } from '../../../../src/skills/handlers';
import { ExecutionStateEmitter } from '../../../../src/skills/execution-state';
import type { ExecutionEvent } from '../../../../src/skills/execution-state';
import { createModelResolver } from '../../../../src/skills/model-resolver';
import { LaunchContextStore } from '../../../../src/skills/launch-context-store';
import type { DeliveryOutcome, DeliveryTarget } from '../../../../src/skills/output/types';
import type {
    Skill,
    SkillStep,
    SkillInput,
    ConfirmationOption,
    PendingConfirmationInfo,
    ExecutionOptions,
} from '../../../../src/skills/types';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Minimal CancellationTokenSource (the vscode mock's has no event). */
class FakeCancellation {
    private listeners: Array<() => void> = [];
    private cancelled = false;
    readonly token: CancellationToken;

    constructor() {
        const self = this;
        this.token = {
            get isCancellationRequested() { return self.cancelled; },
            onCancellationRequested: (listener: () => void) => {
                self.listeners.push(listener);
                return { dispose: () => { self.listeners = self.listeners.filter(l => l !== listener); } };
            },
        } as unknown as CancellationToken;
    }

    cancel(): void {
        if (this.cancelled) return;
        this.cancelled = true;
        for (const l of [...this.listeners]) l();
    }

    dispose(): void {
        this.listeners = [];
    }
}

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void }
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

type InputAnswer = { value: unknown } | 'cancelled' | Deferred<{ value: unknown } | 'cancelled'>;
/** A confirmation answer: an option label, 'cancelled', or a deferred the test resolves. */
type ConfirmationAnswer = string | 'cancelled' | Deferred<string | 'cancelled'>;

class FakeSurface implements RunSurface {
    calls: string[] = [];
    inputAnswers: InputAnswer[] = [];
    confirmationAnswers: ConfirmationAnswer[] = [];
    replaceAnswer = false;
    problems: Array<{ title: string; lines: string[] }> = [];
    replaceAsked: Array<{ current: string; next: string }> = [];
    progressTokens: CancellationToken[] = [];

    async askInput(_skill: Skill, input: SkillInput, position: { index: number; total: number }) {
        this.calls.push(`askInput:${input.name}:${position.index}/${position.total}`);
        const next = this.inputAnswers.shift();
        if (next === undefined) throw new Error(`no scripted answer for input ${input.name}`);
        if (typeof next === 'object' && 'promise' in next) return next.promise;
        return next;
    }

    async askConfirmation(_skill: Skill, pending: PendingConfirmationInfo): Promise<ConfirmationOption | 'cancelled'> {
        this.calls.push(`askConfirmation:${pending.stepId}`);
        const next = this.confirmationAnswers.shift();
        if (next === undefined) throw new Error(`no scripted answer for confirmation ${pending.stepId}`);
        const label = typeof next === 'object' ? await next.promise : next;
        if (label === 'cancelled') return 'cancelled';
        // Return the option by reference: resumeAfterChoice derives selectedIndex from identity.
        const option = pending.options.find(o => o.label === label);
        if (!option) throw new Error(`no option labelled ${label}`);
        return option;
    }

    approvalAnswer: ToolApproval = 'deny';
    approvalAsked: Array<{ skill: string; tool: string }> = [];

    async approveTool(skill: Skill, call: ToolCallRequest): Promise<ToolApproval> {
        this.calls.push('approveTool');
        this.approvalAsked.push({ skill: skill.id, tool: call.toolName });
        return this.approvalAnswer;
    }

    progress(_skill: Skill, token: CancellationToken) {
        this.calls.push('progress');
        this.progressTokens.push(token);
        return { dispose: () => { this.calls.push('progress.dispose'); } };
    }

    async confirmReplaceRun(current: Skill, next: Skill): Promise<boolean> {
        this.calls.push('confirmReplaceRun');
        this.replaceAsked.push({ current: current.id, next: next.id });
        return this.replaceAnswer;
    }

    showProblems(_skill: Skill, title: string, lines: string[]): void {
        this.calls.push('showProblems');
        this.problems.push({ title, lines });
    }

    async showResult(): Promise<void> {
        this.calls.push('showResult');
    }
}

/** Records every llm step it runs; confirmation steps go to the real ConfirmationStepHandler. */
function recordingHandler(runOrder: string[]): StepHandler {
    return {
        category: 'execution',
        handledStepTypes: ['llm'],
        usesLLM: false,
        canHandle: (step) => step.type === 'llm',
        handle: async (ctx: StepContext) => {
            runOrder.push(ctx.step.id);
            if (ctx.step.id === 'gated') {
                const allowed = await ctx.approveTool?.({ toolName: 'mytool', input: {} });
                runOrder.push(`gated:${allowed}`);
            }
            if (ctx.step.id === 'broken') {
                return {
                    action: 'return',
                    statusUpdate: 'error',
                    stepResult: { stepId: ctx.step.id, success: false, error: 'it broke', duration: 1 },
                };
            }
            return {
                action: 'continue',
                statusUpdate: 'completed',
                contextUpdates: { output: `out-${ctx.step.id}`, stepTime: 1 },
                stepResult: { stepId: ctx.step.id, success: true, data: `out-${ctx.step.id}`, duration: 1 },
            };
        },
    };
}

const REVIEW_OPTIONS: ConfirmationOption[] = [
    { label: 'Continue', action: 'continue' },
    { label: 'Revise', action: 'goto', gotoStep: 'draft' },
    { label: 'Cancel', action: 'abort' },
];

function draftReviewPublish(): SkillStep[] {
    return [
        { id: 'draft', type: 'llm', message: 'Draft about {{ inputs.topic }}', output: 'draft' },
        { id: 'review', type: 'confirmation', message: 'Look good?', options: REVIEW_OPTIONS, output: 'decision' },
        { id: 'publish', type: 'llm', message: 'Publish {{ outputs.draft }}', output: 'published' },
    ];
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
    return {
        id: 'writer',
        name: 'Writer',
        description: 'test',
        version: '1.0.0',
        inputs: [{ name: 'topic', type: 'string', description: 'Topic', required: true }],
        tools: { aliases: {} },
        steps: draftReviewPublish(),
        onError: 'continue',
        source: { type: 'builtin', path: '/mock/writer' },
        ...overrides,
    };
}

function noInputSkill(id: string): Skill {
    return makeSkill({
        id,
        name: id,
        inputs: [],
        steps: [{ id: 'only', type: 'llm', message: 'hello', output: 'only' }],
    });
}

const TARGET: DeliveryTarget = {
    uri: 'file:///doc.md',
    version: 3,
    selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
};

/** Let pending promise chains (validation, engine steps) settle. */
async function until(predicate: () => boolean): Promise<void> {
    await vi.waitFor(() => { if (!predicate()) throw new Error('not yet'); }, { timeout: 2000, interval: 1 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunController', () => {
    let runOrder: string[];
    let surface: FakeSurface;
    let executionState: ExecutionStateEmitter;
    let events: ExecutionEvent[];
    let launchStore: LaunchContextStore;
    let deliver: ReturnType<typeof vi.fn>;
    let controller: RunController;
    let deps: RunControllerDeps;

    beforeEach(() => {
        runOrder = [];
        surface = new FakeSurface();
        executionState = new ExecutionStateEmitter();
        events = [];
        executionState.subscribe(e => events.push(e));
        launchStore = new LaunchContextStore();
        deliver = vi.fn(async (): Promise<DeliveryOutcome> => ({ kind: 'none' }));

        const registry = new StepHandlerRegistry();
        registry.register(recordingHandler(runOrder));
        registry.register(new ConfirmationStepHandler());
        const executor = new SkillExecutor(registry, createModelResolver());

        deps = {
            executor,
            executionState,
            surface,
            resolveModel: async () => ({
                model: { id: 'test-model' } as unknown as ExecutionOptions['model'],
                isAutoMode: true,
            }),
            launchStore,
            toolApprovals: new ToolApprovalPolicy({ get: () => [], set: async () => {} }),
            availableMcps: () => [],
            verboseMode: () => 'off',
            deliver: deliver as unknown as RunControllerDeps['deliver'],
            newCancellation: () => new FakeCancellation(),
        };
        controller = new RunController(deps);
    });

    const endCompleted = () => events.some(e => e.type === 'terminal:status' && e.terminal === 'end' && e.status === 'completed');
    const finished = (success: boolean) => events.filter(e => e.type === 'execution:complete' && e.success === success).length;

    it('gives the engine an approver that asks the surface about the running skill', async () => {
        surface.approvalAnswer = 'run';
        const skill = noInputSkill('gate');
        skill.steps = [{ id: 'gated', type: 'llm', message: 'hi', output: 'o' }];

        await controller.run({ skill });

        expect(surface.approvalAsked).toEqual([{ skill: 'gate', tool: 'mytool' }]);
        expect(runOrder).toContain('gated:true');
    });

    it('runs inputs → execute → confirmation(continue) → deliver → showResult and finishes success', async () => {
        const skill = makeSkill();
        launchStore.setTarget(skill.id, TARGET);
        surface.inputAnswers = [{ value: 'cats' }];
        surface.confirmationAnswers = ['Continue'];

        const outcome = await controller.run({ skill });

        expect(outcome.kind).toBe('completed');
        if (outcome.kind !== 'completed') return;
        expect(outcome.result.success).toBe(true);
        expect(outcome.result.context.inputs.topic).toBe('cats');
        expect(outcome.result.context.outputs.decision).toMatchObject({ selectedOption: 'Continue', selectedIndex: 1 });
        expect(runOrder).toEqual(['draft', 'publish']);
        expect(surface.calls).toEqual([
            'askInput:topic:0/1',
            'progress',
            'askConfirmation:review',
            'showResult',
            'progress.dispose',
        ]);
        expect(deliver).toHaveBeenCalledWith(skill, outcome.result, undefined, TARGET);
        expect(outcome.delivery).toEqual({ kind: 'none' });
        expect(finished(true)).toBe(1);
        expect(finished(false)).toBe(0);
        expect(controller.active).toBeUndefined();
    });

    it('prefers the request target over the stashed one', async () => {
        const skill = noInputSkill('plain');
        const requestTarget = { ...TARGET, uri: 'file:///other.md' };
        launchStore.setTarget(skill.id, TARGET);

        await controller.run({ skill, target: requestTarget });

        expect(deliver).toHaveBeenCalledWith(skill, expect.anything(), undefined, requestTarget);
    });

    it('goto loops back and re-runs the target step', async () => {
        surface.inputAnswers = [{ value: 'cats' }];
        surface.confirmationAnswers = ['Revise', 'Continue'];

        const outcome = await controller.run({ skill: makeSkill() });

        expect(outcome.kind).toBe('completed');
        expect(runOrder).toEqual(['draft', 'draft', 'publish']);
        expect(surface.calls.filter(c => c.startsWith('askConfirmation'))).toHaveLength(2);
    });

    it('abort at a confirmation finishes as cancelled and marks the end terminal', async () => {
        surface.inputAnswers = [{ value: 'cats' }];
        surface.confirmationAnswers = ['Cancel'];

        const outcome = await controller.run({ skill: makeSkill() });

        expect(outcome).toEqual({ kind: 'cancelled' });
        expect(runOrder).toEqual(['draft']);
        expect(events).toContainEqual(expect.objectContaining({ type: 'step:status', stepId: 'review', status: 'completed' }));
        expect(endCompleted()).toBe(true);
        expect(finished(false)).toBe(1);
        expect(finished(true)).toBe(0);
        expect(deliver).not.toHaveBeenCalled();
        expect(surface.calls).not.toContain('showResult');
        expect(surface.calls).toContain('progress.dispose');
    });

    it('a cancelled picker ends the run as cancelled and releases the lock', async () => {
        surface.inputAnswers = ['cancelled'];

        const outcome = await controller.run({ skill: makeSkill() });

        expect(outcome).toEqual({ kind: 'cancelled' });
        expect(runOrder).toEqual([]);
        expect(endCompleted()).toBe(true);
        expect(finished(false)).toBe(1);
        expect(controller.active).toBeUndefined();

        // The lock is free: a second run starts without asking to replace anything.
        const second = await controller.run({ skill: noInputSkill('next') });
        expect(second.kind).toBe('completed');
        expect(surface.calls).not.toContain('confirmReplaceRun');
        expect(runOrder).toEqual(['only']);
    });

    it('a second run while one waits asks to replace it; declining keeps the first', async () => {
        const first = makeSkill();
        const gate = deferred<string | 'cancelled'>();
        surface.inputAnswers = [{ value: 'cats' }];
        surface.confirmationAnswers = [gate];

        const firstRun = controller.run({ skill: first });
        await until(() => surface.calls.includes('askConfirmation:review'));

        surface.replaceAnswer = false;
        const second = await controller.run({ skill: noInputSkill('next') });

        expect(second.kind).toBe('notStarted');
        expect(surface.replaceAsked).toEqual([{ current: 'writer', next: 'next' }]);
        expect(controller.active?.skill).toBe(first);
        expect(surface.progressTokens[0].isCancellationRequested).toBe(false);

        // The first run's confirmation is still pending and completes when answered.
        gate.resolve('Continue');
        const firstOutcome = await firstRun;
        expect(firstOutcome.kind).toBe('completed');
        expect(runOrder).toEqual(['draft', 'publish']);
    });

    it('accepting the replacement cancels the waiting run and starts the new one', async () => {
        const gate = deferred<string | 'cancelled'>();
        surface.inputAnswers = [{ value: 'cats' }];
        surface.confirmationAnswers = [gate];

        const firstRun = controller.run({ skill: makeSkill() });
        await until(() => surface.calls.includes('askConfirmation:review'));

        surface.replaceAnswer = true;
        const second = await controller.run({ skill: noInputSkill('next') });

        expect(await firstRun).toEqual({ kind: 'cancelled' });
        expect(second.kind).toBe('completed');
        expect(runOrder).toEqual(['draft', 'only']);
        expect(controller.active).toBeUndefined();
    });

    it('readiness errors are shown and nothing executes', async () => {
        const skill = makeSkill({
            source: { type: 'workspace', path: '/ws/writer' },
            tools: { aliases: { write: 'skiller_writeSkill' } },
        });

        const outcome = await controller.run({ skill });

        expect(outcome.kind).toBe('notStarted');
        expect(surface.problems).toHaveLength(1);
        expect(surface.problems[0].lines.join('\n')).toContain('skiller_writeSkill');
        expect(runOrder).toEqual([]);
        expect(surface.calls).toEqual(['showProblems']);
        expect(events.some(e => e.type === 'execution:start')).toBe(false);
        expect(controller.active).toBeUndefined();
    });

    it('the caller token cancels a waiting run', async () => {
        const caller = new FakeCancellation();
        surface.inputAnswers = [{ value: 'cats' }];
        surface.confirmationAnswers = [deferred<string | 'cancelled'>()]; // never answered

        const run = controller.run({ skill: makeSkill(), token: caller.token });
        await until(() => surface.calls.includes('askConfirmation:review'));
        caller.cancel();

        expect(await run).toEqual({ kind: 'cancelled' });
        expect(surface.progressTokens[0].isCancellationRequested).toBe(true);
        expect(endCompleted()).toBe(true);
        expect(finished(false)).toBe(1);
        expect(runOrder).toEqual(['draft']);
        expect(controller.active).toBeUndefined();
    });

    it('cancelActive cancels a waiting run', async () => {
        surface.inputAnswers = [deferred<{ value: unknown } | 'cancelled'>()]; // never answered

        const run = controller.run({ skill: makeSkill() });
        await until(() => surface.calls.includes('askInput:topic:0/1'));

        expect(controller.cancelActive()).toBe(true);
        expect(await run).toEqual({ kind: 'cancelled' });
        expect(controller.cancelActive()).toBe(false);
        expect(runOrder).toEqual([]);
    });

    it('invalid input is re-asked with the validation error', async () => {
        const skill = makeSkill({
            inputs: [{ name: 'slug', type: 'string', description: 'Slug', required: true, pattern: '^[a-z]+$' }],
            steps: [{ id: 'only', type: 'llm', message: 'use {{ inputs.slug }}', output: 'only' }],
        });
        surface.inputAnswers = [{ value: 'NOT OK' }, { value: 'fine' }];

        const outcome = await controller.run({ skill });

        expect(surface.calls.slice(0, 3)).toEqual(['askInput:slug:0/1', 'showProblems', 'askInput:slug:0/1']);
        expect(surface.problems[0].lines.join('\n')).toContain('does not match pattern');
        expect(outcome.kind).toBe('completed');
        if (outcome.kind === 'completed') expect(outcome.result.context.inputs.slug).toBe('fine');
    });

    it('coerces typed answers and uses the default for an empty answer', async () => {
        const skill = makeSkill({
            inputs: [
                { name: 'count', type: 'number', description: 'Count', required: true },
                { name: 'tone', type: 'string', description: 'Tone', required: false, prompt: 'Tone?', default: 'calm' },
            ],
            steps: [{ id: 'only', type: 'llm', message: 'x', output: 'only' }],
        });
        surface.inputAnswers = [{ value: '3' }, { value: '' }];

        const outcome = await controller.run({ skill });

        expect(surface.calls.filter(c => c.startsWith('askInput'))).toEqual(['askInput:count:0/2', 'askInput:tone:1/2']);
        expect(outcome.kind).toBe('completed');
        if (outcome.kind === 'completed') {
            expect(outcome.result.context.inputs).toMatchObject({ count: 3, tone: 'calm' });
        }
    });

    it('a failed skill still shows its result and finishes unsuccessfully', async () => {
        const skill = makeSkill({
            inputs: [],
            onError: 'abort',
            steps: [
                { id: 'broken', type: 'llm', message: 'x', output: 'broken' },
                { id: 'after', type: 'llm', message: 'y', output: 'after' },
            ],
        });

        const outcome = await controller.run({ skill });

        expect(outcome.kind).toBe('completed');
        if (outcome.kind !== 'completed') return;
        expect(outcome.result.success).toBe(false);
        expect(outcome.result.error).toBe('it broke');
        expect(runOrder).toEqual(['broken']);
        expect(deliver).toHaveBeenCalledWith(skill, outcome.result, undefined, undefined);
        expect(surface.calls).toContain('showResult');
        expect(surface.calls).not.toContain('showProblems');
        expect(finished(false)).toBe(1);
        expect(finished(true)).toBe(0);
    });

    it('an error thrown by the run is shown and ends the run as failed', async () => {
        const failing = new RunController({
            ...deps,
            resolveModel: async () => { throw new Error('No language model selected.'); },
        });

        const outcome = await failing.run({ skill: noInputSkill('plain') });

        expect(outcome).toEqual({ kind: 'failed', message: 'No language model selected.' });
        expect(surface.problems).toEqual([{ title: "Skill 'plain' failed", lines: ['No language model selected.'] }]);
        expect(runOrder).toEqual([]);
        expect(finished(false)).toBe(1);
        expect(failing.active).toBeUndefined();
    });

    it('explicit inputs are not asked for', async () => {
        surface.confirmationAnswers = ['Continue'];

        const outcome = await controller.run({ skill: makeSkill(), inputs: { topic: 'dogs' } });

        expect(surface.calls.some(c => c.startsWith('askInput'))).toBe(false);
        expect(outcome.kind).toBe('completed');
        if (outcome.kind === 'completed') expect(outcome.result.context.inputs.topic).toBe('dogs');
    });
});
