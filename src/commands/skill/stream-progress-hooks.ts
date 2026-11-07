/**
 * Chat Stream Progress Hooks
 *
 * The chat surface's ProgressHooks implementation: renders abstract progress
 * events into a VS Code chat response stream. Supplied to the executor through
 * ExecutionOptions.hooks by createExecutionOptions.
 */

import type * as vscode from 'vscode';
import type { ProgressHooks } from '../../skills';
import type { VerboseMode, ConfirmationOption, StepModelInfo } from '../../skills/types';
import { formatDuration, fence } from '../../skills/utils';

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
