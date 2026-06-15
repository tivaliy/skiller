/**
 * Shared Step Handler Utilities
 *
 * Common functions used by multiple step handlers.
 * Extracted to avoid duplication while maintaining separation of concerns.
 */

import type { Skill, SkillStep, StepResult } from '../types';
import type { HandlerResult, ContextUpdates, StepContext } from './types';

/**
 * Build a handler result from a step result
 *
 * Creates the standardized HandlerResult with context updates.
 * Handles error strategy (abort vs continue) appropriately.
 *
 * @param ctx - Step context (for skill and step info)
 * @param stepResult - The step execution result
 * @returns HandlerResult for the executor to process
 */
export function buildHandlerResult(ctx: StepContext, stepResult: StepResult): HandlerResult {
    const { skill, step } = ctx;

    // Build context updates (executor will apply these)
    const contextUpdates: ContextUpdates = {
        stepTime: stepResult.duration
    };

    // Always store output data when available, regardless of step success.
    // Guard steps (when: outputs.X.success != true) rely on output being populated
    // even when the step fails at the executor level (e.g. tool errors detected),
    // as long as the LLM still produced diagnostic data (e.g. {success: false, error: ...}).
    if (step.output && stepResult.data !== undefined) {
        contextUpdates.output = stepResult.data;
    }

    // Determine status for executor to apply
    const statusUpdate = stepResult.success ? 'completed' : 'error';

    // Check error strategy - let executor build skillResult
    if (!stepResult.success && skill.onError === 'abort') {
        return {
            action: 'return',
            stepResult,
            contextUpdates,
            statusUpdate
        };
    }

    return {
        action: 'continue',
        stepResult,
        contextUpdates,
        statusUpdate
    };
}

/**
 * Create an error step result
 *
 * @param stepId - ID of the step that failed
 * @param error - Error that occurred
 * @param stepStart - Timestamp when step started (for duration)
 * @returns StepResult indicating failure
 */
export function createErrorResult(
    stepId: string,
    error: unknown,
    stepStart: number
): StepResult {
    return {
        stepId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - stepStart
    };
}

/**
 * Handle missing step file error
 *
 * Used by handlers that require a step file (like LLM handler).
 *
 * @param ctx - Step context
 * @returns HandlerResult with error
 */
export function handleMissingStepFile(ctx: StepContext): HandlerResult {
    const { skill, step } = ctx;

    const errorResult: StepResult = {
        stepId: step.id,
        success: false,
        error: `Step file not found: ${step.file}`,
        duration: 0
    };

    // Return error - executor will build skillResult if abort strategy
    if (skill.onError === 'abort') {
        return {
            action: 'return',
            stepResult: errorResult,
            contextUpdates: { stepTime: 0 },
            statusUpdate: 'error'
        };
    }

    // A missing step file is a failure (status 'error'); under onError:continue it
    // advances like any other continued failure (same action as buildHandlerResult).
    return {
        action: 'continue',
        stepResult: errorResult,
        contextUpdates: { stepTime: 0 },
        statusUpdate: 'error'
    };
}

/**
 * Create a skipped step result
 *
 * Used when a step is intentionally skipped (e.g., optional tool not available).
 *
 * @param stepId - ID of the step being skipped
 * @param reason - Reason for skipping
 * @returns StepResult indicating the step was skipped
 */
export function createSkippedResult(stepId: string, reason: string): StepResult {
    return {
        stepId,
        success: true,  // Skipped steps are considered successful
        skipped: true,
        skipReason: reason,
        duration: 0
    };
}

/**
 * Build a handler result for a skipped step
 *
 * @param ctx - Step context
 * @param reason - Reason for skipping
 * @returns HandlerResult that continues execution
 */
export function buildSkippedHandlerResult(ctx: StepContext, reason: string): HandlerResult {
    const stepResult = createSkippedResult(ctx.step.id, reason);

    return {
        action: 'continue',
        stepResult,
        contextUpdates: { stepTime: 0 },
        statusUpdate: 'skipped'
    };
}
