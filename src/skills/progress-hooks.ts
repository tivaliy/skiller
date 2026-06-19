/**
 * Progress Hooks
 *
 * Defines ProgressHooks interface and factory for rendering execution progress.
 * This is the UI adapter layer - translates abstract progress events into
 * VS Code-specific UI updates.
 */

import type * as vscode from 'vscode';
import type { VerboseMode, ConfirmationOption, StepModelInfo } from './types';
import { formatDuration, fence } from './utils';

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
     */
    onStepComplete?: (stepId: string, success: boolean, duration: number, error?: string) => void;

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
     * Called when LLM streams a text chunk.
     * @param chunk - Text chunk from LLM stream
     * @param isFirst - True if this is the first chunk (for UI initialization)
     */
    onStreamChunk?: (chunk: string, isFirst: boolean) => void;

    /**
     * Called when LLM streaming completes.
     * Allows UI to finalize streaming display.
     */
    onStreamEnd?: () => void;

    /**
     * Called to display the interpolated prompt before LLM execution.
     * Only invoked when verbose mode is enabled.
     * @param prompt - The interpolated prompt text
     */
    onPromptDisplay?: (prompt: string) => void;

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

// ============================================================================
// Factory
// ============================================================================

/**
 * Create progress hooks that render to a VS Code chat stream.
 *
 * Execution functions receive ProgressHooks interface, keeping them UI-agnostic.
 * This factory creates the VS Code-specific implementation.
 *
 * @param stream - The chat response stream to render to
 * @param verboseMode - Controls prompt/response visibility
 * @returns ProgressHooks implementation
 */
export function createStreamProgressHooks(
    stream: vscode.ChatResponseStream | undefined,
    verboseMode: VerboseMode
): ProgressHooks {
    // Track streaming state for proper section closure
    let streamingActive = false;
    const isVerbose = verboseMode !== 'off';
    const isRaw = verboseMode === 'raw';

    return {
        onStepStart: (stepId: string, stepIndex: number, totalSteps: number, modelInfo?: StepModelInfo) => {
            if (!stream) return;

            // Build step header with optional model badge
            let header = `**Step ${stepIndex + 1}/${totalSteps}: ${stepId}**`;

            // Add model badge for non-auto sources (skill-step or user-override)
            // Don't show badge for 'auto' or 'skill-default' to reduce noise
            if (modelInfo && (modelInfo.source === 'skill-step' || modelInfo.source === 'user-override')) {
                header += ` [${modelInfo.displayName}]`;
            }

            stream.markdown(`${header}\n`);
        },

        onStepComplete: (stepId: string, success: boolean, duration: number, error?: string) => {
            if (!stream) return;

            const statusIcon = success ? '✓' : '❌';
            const durationStr = formatDuration(duration);
            stream.markdown(`${statusIcon} Complete (${durationStr})\n`);

            // Show error in verbose mode or on failure
            if ((isVerbose || !success) && error) {
                stream.markdown(`\n**Error:** ${error}\n`);
            }
            stream.markdown('\n');
        },

        onPhaseStart: (phase: string) => {
            if (!stream) return;
            stream.progress(`${phase}...`);
        },

        onPhaseComplete: (_phase: string) => {
            // Spinner is replaced by next phase or step completion
        },

        onStreamChunk: (chunk: string, isFirst: boolean) => {
            if (!stream || !isVerbose) return;

            if (isFirst) {
                if (isRaw) {
                    // Raw mode: code fence for plain text output
                    // Using ~~~ (tildes) to avoid collision with ``` in response content
                    stream.markdown('\n> *Response:*\n\n~~~\n');
                } else {
                    // Rendered mode: separator before markdown content
                    stream.markdown('\n> *Response:*\n\n---\n\n');
                }
                streamingActive = true;
            }
            stream.markdown(chunk);
        },

        onStreamEnd: () => {
            if (!stream || !streamingActive) return;

            if (isRaw) {
                stream.markdown('\n~~~\n\n');
            } else {
                stream.markdown('\n\n---\n');
            }
            streamingActive = false;
        },

        onPromptDisplay: (prompt: string) => {
            if (!stream || !isVerbose) return;

            if (isRaw) {
                // Raw mode: fenced code block (inner fences neutralized by fence()).
                stream.markdown(`\n> *Prompt:*\n\n${fence(prompt)}\n\n`);
            } else {
                // Rendered mode: show prompt as markdown
                stream.markdown(`\n> *Prompt:*\n\n---\n\n${prompt}\n\n---\n\n`);
            }
        },

        onSkillComplete: (duration: number, summary?: string) => {
            if (!stream) return;
            stream.markdown(`\n**Skill completed** in ${formatDuration(duration)}\n`);
            if (summary) {
                stream.markdown(`\n${summary}\n`);
            }
        },

        onSkillError: (error: string, stepContext?: string) => {
            if (!stream) return;
            let message = `\n❌ **Skill execution failed**\n\n**Error:** ${error}`;
            if (stepContext) {
                message += `\n${stepContext}`;
            }
            stream.markdown(message + '\n');
        },

        onStepSkipped: (stepId: string, stepIndex: number, totalSteps: number, reason: string) => {
            if (!stream) return;
            stream.markdown(
                `⏭️ Step ${stepIndex + 1}/${totalSteps}: **${stepId}** *(skipped)*\n`
            );
        },

        onConfirmationRequired: (
            message: string,
            options: ConfirmationOption[],
            stepIndex: number,
            totalSteps: number
        ) => {
            if (!stream) return;
            stream.markdown('\n---\n\n');
            stream.markdown(`⏸️ **Step ${stepIndex + 1}/${totalSteps}: Confirmation Required**\n\n`);
            stream.markdown(message);
            stream.markdown('\n\n---\n\n');
            stream.markdown('**Select an option** (reply with number):\n\n');
            options.forEach((opt, idx) => {
                stream.markdown(`**${idx + 1}.** ${opt.label}\n`);
            });
            stream.markdown('\n_Type `cancel` to abort._\n');
        },

        onNoHandler: (stepId: string, stepType: string) => {
            if (!stream) return;
            stream.markdown(`❌ **Error:** No handler found for step type: ${stepType}\n\n`);
        },

        onModelFallback: (stepId: string, requestedModel: string, actualModel: string) => {
            if (!stream) return;
            stream.markdown(`⚠️ Model "${requestedModel}" unavailable, using "${actualModel}"\n`);
        }
    };
}
