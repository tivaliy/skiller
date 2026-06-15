/**
 * ExecutionContext factory for testing interpolation and related functions
 */

import type {
    ExecutionContext,
    Skill,
    SkillSource,
} from '../../../src/skills/types';

/**
 * Override options for creating a mock ExecutionContext
 */
export interface ContextOverrides {
    inputs?: Record<string, unknown>;
    outputs?: Record<string, unknown>;
    currentStep?: number;
    totalSteps?: number;
    availableMcps?: string[];
    skill?: Partial<Skill>;
    startTime?: number;
    stepTimes?: Record<string, number>;
}

/**
 * Create a mock ExecutionContext for testing
 */
export function createMockExecutionContext(
    overrides: ContextOverrides = {}
): ExecutionContext {
    const defaultSource: SkillSource = {
        type: 'builtin',
        path: '/mock/skills/test-skill',
    };

    const defaultSkill: Skill = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill for testing',
        version: '1.0.0',
        inputs: [],
        tools: { aliases: {} },
        steps: [],
        onError: 'abort',
        source: defaultSource,
        ...overrides.skill,
    };

    return {
        inputs: overrides.inputs ?? {},
        outputs: overrides.outputs ?? {},
        currentStep: overrides.currentStep ?? 0,
        totalSteps: overrides.totalSteps ?? 1,
        skill: defaultSkill,
        startTime: overrides.startTime ?? Date.now(),
        stepTimes: overrides.stepTimes ?? {},
        availableMcps: overrides.availableMcps ?? [],
    };
}
