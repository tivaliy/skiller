/**
 * Confirmation Step Handler
 *
 * Handles confirmation steps that pause execution for user input.
 * Renders the confirmation message via hooks, then pauses.
 *
 * Single Responsibility: Only handles confirmation step type.
 */

import type { SkillStep, StepType, StepResult, ExecutionContext, ConfirmationOption } from '../types';
import type { ProgressHooks } from '../progress-hooks';
import type { StepHandler, StepContext, HandlerResult, HandlerCategory } from './types';
import { interpolate } from '../interpolation';

/**
 * Handler for confirmation steps
 *
 * Confirmation steps:
 * 1. Render message to user via hooks
 * 2. Show available options
 * 3. Pause execution (return with pendingConfirmation)
 * 4. Resume happens via executor.execute() with resumeOptions
 *
 * Returns statusUpdate for executor to apply (no direct state mutation).
 */
export class ConfirmationStepHandler implements StepHandler {
    readonly category: HandlerCategory = 'confirmation';
    readonly handledStepTypes: readonly StepType[] = ['confirmation'];
    readonly usesLLM: boolean = false;
    readonly inspectionKind = 'confirmation' as const;

    canHandle(step: SkillStep): boolean {
        return step.type === 'confirmation';
    }

    async handle(ctx: StepContext, hooks: ProgressHooks): Promise<HandlerResult> {
        const { step, stepIndex, totalSteps, parsedStep, context } = ctx;

        // Signal awaiting confirmation via hook
        hooks.onPhaseStart?.('Awaiting confirmation');

        // Get confirmation message from file or inline
        const message = this.resolveMessage(step, parsedStep, context);

        // Get options (with defaults)
        const options: ConfirmationOption[] = step.options || [
            { label: 'Continue', action: 'continue' as const },
            { label: 'Cancel', action: 'abort' as const }
        ];

        // Render via hook (consistent with other UI rendering)
        hooks.onConfirmationRequired?.(message, options, stepIndex, totalSteps);

        // Signal phase complete
        hooks.onPhaseComplete?.('Awaiting user response');

        // Create step result
        // Duration is 0 because confirmation steps pause for user input - actual time
        // is indeterminate and not meaningful for performance metrics
        const stepResult: StepResult = {
            stepId: step.id,
            success: true,
            duration: 0,
            prompt: message
        };

        const pendingInfo = {
            stepIndex,
            stepId: step.id,
            message,
            options
        };

        return {
            action: 'return',
            stepResult,
            pendingConfirmation: pendingInfo,
            // Confirmation steps don't report completion - they pause for user input
            reportCompletion: false,
            // Step is awaiting user input (distinct from 'active' which means executing)
            statusUpdate: 'awaiting-input'
        };
    }

    /**
     * Resolve confirmation message from file or inline
     */
    private resolveMessage(
        step: SkillStep,
        parsedStep: { prompt: string } | undefined,
        context: ExecutionContext
    ): string {
        if (parsedStep?.prompt) {
            return interpolate(parsedStep.prompt, context);
        }
        if (step.message) {
            return interpolate(step.message, context);
        }
        return 'Please confirm to continue.';
    }
}
