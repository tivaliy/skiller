/**
 * Skill Result Builder
 *
 * Centralized factory for creating SkillResult objects.
 * Ensures consistent result structure across all execution paths.
 */

import type {
    SkillResult,
    StepResult,
    ExecutionContext,
    PendingConfirmationInfo
} from './types';

/**
 * Builder for creating SkillResult objects
 *
 * Provides a fluent API for constructing results with consistent structure.
 * All result creation flows through this builder for uniformity.
 *
 * @example
 * const builder = new SkillResultBuilder(skill.id, startTime);
 * return builder.success(steps, context, summary);
 */
export class SkillResultBuilder {
    constructor(
        private readonly skillId: string,
        private readonly startTime: number
    ) {}

    /**
     * Calculate duration from start time to now
     */
    private getDuration(): number {
        return Date.now() - this.startTime;
    }

    /**
     * Create a successful skill result
     *
     * @param steps - Completed step results
     * @param context - Final execution context
     * @param summary - Optional summary from output template
     */
    success(
        steps: StepResult[],
        context: ExecutionContext,
        summary?: string
    ): SkillResult {
        return {
            skillId: this.skillId,
            success: true,
            steps,
            context,
            duration: this.getDuration(),
            summary
        };
    }

    /**
     * Create an error result
     *
     * @param steps - Step results collected before failure
     * @param context - Execution context at time of failure
     * @param error - Error message
     */
    error(
        steps: StepResult[],
        context: ExecutionContext,
        error: string
    ): SkillResult {
        return {
            skillId: this.skillId,
            success: false,
            steps,
            context,
            duration: this.getDuration(),
            error
        };
    }

    /**
     * Create a cancelled result
     *
     * @param steps - Step results collected before cancellation
     * @param context - Execution context at time of cancellation
     */
    cancelled(
        steps: StepResult[],
        context: ExecutionContext
    ): SkillResult {
        return {
            skillId: this.skillId,
            success: false,
            steps,
            context,
            duration: this.getDuration(),
            error: 'Execution cancelled'
        };
    }

    /**
     * Create a result for pending confirmation
     *
     * Used when execution pauses for user input.
     *
     * @param steps - Step results collected so far (including confirmation step)
     * @param context - Execution context at time of pause
     * @param pendingConfirmation - Information about the pending confirmation
     */
    pendingConfirmation(
        steps: StepResult[],
        context: ExecutionContext,
        pendingConfirmation: PendingConfirmationInfo
    ): SkillResult {
        return {
            skillId: this.skillId,
            success: true,
            steps,
            context,
            duration: this.getDuration(),
            pendingConfirmation
        };
    }
}
