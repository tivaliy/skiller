/**
 * Tests that SkillExecutor captures step inspection data (interpolated prompt +
 * response) into execution-state, gated by the HANDLER's declared inspectionKind
 * (not the step type), so the graph can surface it on hover.
 */

import { describe, it, expect } from 'vitest';
import { SkillExecutor } from '../../../src/skills/SkillExecutor';
import { StepHandlerRegistry } from '../../../src/skills/handlers';
import type { StepHandler, StepContext } from '../../../src/skills/handlers';
import { ExecutionStateEmitter } from '../../../src/skills/execution-state';
import type { StepInspectionKind } from '../../../src/skills/execution-state';
import { createModelResolver } from '../../../src/skills/model-resolver';
import type { Skill, SkillStep, StepType, ExecutionOptions } from '../../../src/skills/types';

/** A handler that echoes a prompt + response, for a given step type and inspection kind. */
function makeHandler(opts: { type: StepType; inspectionKind?: StepInspectionKind }): StepHandler {
    return {
        category: 'execution',
        handledStepTypes: [opts.type],
        usesLLM: false,
        inspectionKind: opts.inspectionKind,
        canHandle: (step) => step.type === opts.type,
        handle: async (ctx: StepContext) => ({
            action: 'continue',
            statusUpdate: 'completed',
            contextUpdates: { output: 'x', stepTime: 1 },
            stepResult: {
                stepId: ctx.step.id,
                success: true,
                data: `response-for-${ctx.step.id}`,
                duration: 3,
                prompt: `prompt-for-${ctx.step.id}`,
            },
        }),
    };
}

function makeSkill(steps: SkillStep[]): Skill {
    return {
        id: 'debug-skill',
        name: 'Debug Skill',
        description: 'test',
        version: '1.0.0',
        inputs: [],
        tools: { aliases: {} },
        steps,
        onError: 'continue',
        source: { type: 'builtin', path: '/mock/debug-skill' },
    };
}

function makeOptions(executionState: ExecutionStateEmitter): ExecutionOptions {
    return {
        inputs: {},
        model: { id: 'test-model' } as unknown as ExecutionOptions['model'],
        isAutoMode: true,
        token: { isCancellationRequested: false } as unknown as ExecutionOptions['token'],
        stream: undefined,
        availableMcps: [],
        executionState,
    };
}

async function run(handler: StepHandler, steps: SkillStep[]): Promise<ExecutionStateEmitter> {
    const registry = new StepHandlerRegistry();
    registry.register(handler);
    const executor = new SkillExecutor(registry, createModelResolver());
    const es = new ExecutionStateEmitter();
    await executor.execute(makeSkill(steps), makeOptions(es));
    return es;
}

describe('SkillExecutor step inspection capture', () => {
    it('records prompt and response for a step whose handler declares an inspectionKind', async () => {
        const es = await run(
            makeHandler({ type: 'llm', inspectionKind: 'llm' }),
            [{ id: 'analyze', type: 'llm', message: 'inline' }]
        );

        const insp = es.getState('debug-skill')!.stepInspections.get('analyze');
        expect(insp).toBeDefined();
        expect(insp!.kind).toBe('llm');
        expect(insp!.prompt).toBe('prompt-for-analyze');
        expect(insp!.response).toBe('response-for-analyze');
    });

    it('does not record inspection when the handler declares no inspectionKind', async () => {
        const es = await run(
            makeHandler({ type: 'llm' }), // inspectionKind undefined
            [{ id: 'analyze', type: 'llm', message: 'inline' }]
        );

        expect(es.getState('debug-skill')!.stepInspections.has('analyze')).toBe(false);
    });

    it('captures by the handler kind, not the step type', async () => {
        const es = await run(
            makeHandler({ type: 'tool', inspectionKind: 'llm' }),
            [{ id: 'fetch', type: 'tool', tool: 'x' }]
        );

        const insp = es.getState('debug-skill')!.stepInspections.get('fetch');
        expect(insp).toBeDefined();
        expect(insp!.kind).toBe('llm');
    });
});
