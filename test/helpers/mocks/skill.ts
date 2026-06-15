/**
 * Skill and Step mock factories for parser/validator/executor tests
 */

import type {
    Skill,
    SkillStep,
    SkillInput,
    SkillSource,
    SkillTools,
    ConfirmationOption,
} from '../../../src/skills/types';

import type {
    ValidationResult,
    ValidationIssue,
} from '../../../src/skills/validators';

/**
 * Create a mock SkillSource
 */
export function createMockSkillSource(
    overrides: Partial<SkillSource> = {}
): SkillSource {
    return {
        type: 'builtin',
        path: '/mock/path/to/skill',
        ...overrides,
    };
}

/**
 * Create a mock SkillStep
 */
export function createMockStep(overrides: Partial<SkillStep> = {}): SkillStep {
    return {
        id: 'step-1',
        type: 'llm',
        file: 'steps/01-step.md',
        ...overrides,
    };
}

/**
 * Create a mock SkillInput
 */
export function createMockInput(overrides: Partial<SkillInput> = {}): SkillInput {
    return {
        name: 'test_input',
        type: 'string',
        description: 'A test input parameter',
        required: true,
        ...overrides,
    };
}

/**
 * Create a mock SkillTools
 */
export function createMockTools(overrides: Partial<SkillTools> = {}): SkillTools {
    return {
        aliases: {},
        ...overrides,
    };
}

/**
 * Create a mock Skill
 */
export function createMockSkill(overrides: Partial<Skill> = {}): Skill {
    return {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill for testing',
        version: '1.0.0',
        inputs: [],
        tools: createMockTools(overrides.tools),
        steps: overrides.steps ?? [createMockStep()],
        onError: 'abort',
        source: createMockSkillSource(overrides.source),
        ...overrides,
    };
}

/**
 * Create a mock ConfirmationOption
 */
export function createMockConfirmationOption(
    overrides: Partial<ConfirmationOption> = {}
): ConfirmationOption {
    return {
        label: 'Continue',
        action: 'continue',
        ...overrides,
    };
}

/**
 * Create a mock ValidationResult
 */
export function createMockValidationResult(
    overrides: Partial<ValidationResult> = {}
): ValidationResult {
    const errors = overrides.errors ?? [];
    const warnings = overrides.warnings ?? [];
    return {
        valid: overrides.valid ?? true,
        issues: [...errors, ...warnings],
        errors,
        warnings,
        phasesRun: overrides.phasesRun ?? ['schema', 'semantic', 'template', 'security'],  // Note: 'raw' phase removed - Zod validation happens in parser
        duration: overrides.duration ?? 10,
        ...overrides,
    };
}

/**
 * Create a mock ValidationIssue (replaces old ValidationError)
 */
export function createMockValidationIssue(
    overrides: Partial<ValidationIssue> = {}
): ValidationIssue {
    return {
        ruleId: overrides.ruleId ?? 'schema/required-fields',
        severity: overrides.severity ?? 'error',
        phase: overrides.phase ?? 'schema',
        category: overrides.category ?? 'structure',
        message: overrides.message ?? 'A required field is missing',
        location: overrides.location,
        suggestion: overrides.suggestion,
        ...overrides,
    };
}
