/**
 * The executor renders progress only through the ProgressHooks it is given
 * (ExecutionOptions.hooks), never through a chat stream it builds itself — so
 * any surface (chat today, the native runner next) can supply its own UI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillExecutor } from '../../../src/skills/SkillExecutor';
import { StepHandlerRegistry } from '../../../src/skills/handlers';
import type { StepHandler, StepContext } from '../../../src/skills/handlers';
import { ExecutionStateEmitter } from '../../../src/skills/execution-state';
import type { ExecutionEvent } from '../../../src/skills/execution-state';
import { createModelResolver } from '../../../src/skills/model-resolver';
import type { ProgressHooks } from '../../../src/skills/progress-hooks';
import type { Skill, ExecutionOptions } from '../../../src/skills/types';

function passingHandler(): StepHandler {
    return {
        category: 'execution',
        handledStepTypes: ['llm'],
        usesLLM: false,
        canHandle: () => true,
        handle: async (ctx: StepContext) => ({
            action: 'continue',
            statusUpdate: 'completed',
            contextUpdates: { output: `out-${ctx.step.id}`, stepTime: 1 },
            stepResult: { stepId: ctx.step.id, success: true, data: `out-${ctx.step.id}`, duration: 1 },
        }),
    };
}

function makeSkill(stepIds: string[]): Skill {
    return {
        id: 'hooks-skill',
        name: 'Hooks Skill',
        description: 'test',
        version: '1.0.0',
        inputs: [],
        tools: { aliases: {} },
        steps: stepIds.map(id => ({ id, type: 'llm', message: `inline ${id}`, output: id })),
        onError: 'continue',
        source: { type: 'builtin', path: '/mock/hooks-skill' },
    };
}

function makeOptions(executionState: ExecutionStateEmitter, hooks: ProgressHooks): ExecutionOptions {
    return {
        inputs: {},
        model: { id: 'test-model' } as unknown as ExecutionOptions['model'],
        token: { isCancellationRequested: false } as unknown as ExecutionOptions['token'],
        hooks,
        availableMcps: [],
        executionState,
    };
}

describe('SkillExecutor progress hooks', () => {
    let executor: SkillExecutor;
    let executionState: ExecutionStateEmitter;

    beforeEach(() => {
        const registry = new StepHandlerRegistry();
        registry.register(passingHandler());
        executor = new SkillExecutor(registry, createModelResolver());
        executionState = new ExecutionStateEmitter();
    });

    it('renders progress through the injected hooks', async () => {
        const hooks = { onStepStart: vi.fn(), onStepComplete: vi.fn(), onSkillComplete: vi.fn() };
        await executor.execute(makeSkill(['draft']), makeOptions(executionState, hooks));
        expect(hooks.onStepStart).toHaveBeenCalledWith('draft', 0, 1);
        expect(hooks.onStepComplete).toHaveBeenCalled();
        expect(hooks.onSkillComplete).toHaveBeenCalledTimes(1);
    });

    it('passes each completed step its output, so a surface can log what the step produced', async () => {
        const onStepComplete = vi.fn();
        await executor.execute(makeSkill(['draft']), makeOptions(executionState, { onStepComplete }));
        expect(onStepComplete).toHaveBeenCalledWith('draft', true, 1, undefined, 'out-draft');
    });

    it('still emits step statuses to execution state when hooks are no-ops', async () => {
        const seen: string[] = [];
        executionState.subscribe((e: ExecutionEvent) => {
            if (e.type === 'step:status') seen.push(`${e.stepId}:${e.status}`);
        });
        await executor.execute(makeSkill(['draft']), makeOptions(executionState, {}));
        expect(seen).toContain('draft:completed');
    });

    it('uses the injected hooks on a resumed run', async () => {
        const skill = makeSkill(['first', 'second']);
        const first = await executor.execute(skill, makeOptions(executionState, {}));
        const hooks = { onStepStart: vi.fn() };
        await executor.execute(skill, makeOptions(executionState, hooks), {
            startFromStep: 1,
            existingContext: first.context,
            existingStepResults: first.steps.slice(0, 1),
        });
        expect(hooks.onStepStart).toHaveBeenCalledWith('second', 1, 2);
        expect(hooks.onStepStart).not.toHaveBeenCalledWith('first', 0, 2);
    });
});
