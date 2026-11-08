/**
 * Progress Hooks
 *
 * The ProgressHooks interface: abstract progress events the executor and step
 * handlers emit. Each run surface supplies its own implementation via
 * ExecutionOptions.hooks (the native runner's lives in skills/run).
 */

import type { ConfirmationOption, StepModelInfo } from './types';

// ============================================================================
// Progress Hooks Interface
// ============================================================================

/**
 * Progress hooks for observing step execution phases.
 *
 * Used to report sub-stage progress during step execution
 * without coupling execution logic to UI concerns.
 *
 * Example phases: "Analyzing request", "Calling get_page", "Analyzing results"
 */
export interface ProgressHooks {
    /**
     * Called when a step starts execution.
     * @param stepId - The step identifier
     * @param stepIndex - Zero-based index
     * @param totalSteps - Total number of steps
     * @param modelInfo - Optional model information for display
     */
    onStepStart?: (stepId: string, stepIndex: number, totalSteps: number, modelInfo?: StepModelInfo) => void;

    /**
     * Called when a step completes.
     * @param stepId - The step identifier
     * @param success - Whether the step succeeded
     * @param duration - Duration in milliseconds
     * @param error - Error message if failed
     * @param output - What the step produced (its result data), if anything
     */
    onStepComplete?: (stepId: string, success: boolean, duration: number, error?: string, output?: unknown) => void;

    /**
     * Called when a new execution phase starts.
     * @param phase - Human-readable phase description
     */
    onPhaseStart?: (phase: string) => void;

    /**
     * Called when an execution phase completes.
     * @param phase - Human-readable phase description
     */
    onPhaseComplete?: (phase: string) => void;

    /**
     * Called when skill execution completes successfully.
     * @param duration - Total execution time in milliseconds
     * @param summary - Optional summary from skill output template
     */
    onSkillComplete?: (duration: number, summary?: string) => void;

    /**
     * Called when skill execution fails with an error.
     * @param error - Error message
     * @param stepContext - Optional context about which step failed
     */
    onSkillError?: (error: string, stepContext?: string) => void;

    /**
     * Called when a step is skipped due to condition not being met.
     * @param stepId - The step identifier
     * @param stepIndex - Zero-based index
     * @param totalSteps - Total number of steps
     * @param reason - Why the step was skipped
     */
    onStepSkipped?: (stepId: string, stepIndex: number, totalSteps: number, reason: string) => void;

    /**
     * Called when a confirmation step requires user input.
     * @param message - The confirmation message to display
     * @param options - Available confirmation options
     * @param stepIndex - Zero-based index of the confirmation step
     * @param totalSteps - Total number of steps
     */
    onConfirmationRequired?: (
        message: string,
        options: ConfirmationOption[],
        stepIndex: number,
        totalSteps: number
    ) => void;

    /**
     * Called when no handler is found for a step type.
     * @param stepId - The step identifier
     * @param stepType - The unhandled step type
     */
    onNoHandler?: (stepId: string, stepType: string) => void;

    /**
     * Called when a requested model is unavailable and fallback is used.
     * @param stepId - The step identifier
     * @param requestedModel - The model that was requested but unavailable
     * @param actualModel - The fallback model being used
     */
    onModelFallback?: (stepId: string, requestedModel: string, actualModel: string) => void;
}
