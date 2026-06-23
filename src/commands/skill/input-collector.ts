/**
 * Input Collector
 *
 * Handles interactive input collection for skills.
 * Manages the multi-turn input prompting flow.
 *
 * Single Responsibility: Collect and validate user inputs.
 */

import * as vscode from 'vscode';
import { CommandContext, CommandResult } from '../types';
import {
    PendingStateManager,
    SkillInput,
    validateInputs,
    validateSingleInput,
    applyDefaults
} from '../../skills';
import { coerceValue } from './argument-parser';
import { createExecutionOptions } from './execution-options';
import { finalizeSkillRun } from './finalize';
import * as presenter from './presenter';

/**
 * Pending input collection info type
 */
type PendingInputInfo = ReturnType<PendingStateManager['getPendingInputCollection']>;

/**
 * Execute skill after all inputs have been collected
 */
async function executeAfterInputCollection(
    ctx: CommandContext,
    pending: PendingInputInfo
): Promise<CommandResult> {
    const { stream, pendingStateManager, skillExecutor, executionState } = ctx;

    if (!pending) {
        return { handled: false, metadata: {} };
    }

    const collectedInputs = pendingStateManager.getCollectedInputs();
    const skill = pending.skill;

    pendingStateManager.clearPendingInputCollection();

    presenter.showAllInputsCollected(stream);

    // Apply defaults to collected inputs
    const inputsWithDefaults = applyDefaults(skill, collectedInputs);

    // Final validation
    const validation = validateInputs(skill, inputsWithDefaults);
    if (!validation.valid) {
        presenter.showValidationErrors(stream, validation.errors);
        return {
            handled: true,
            metadata: {
                command: 'skill_input',
                skillId: skill.id,
                error: 'validation_failed',
                errors: validation.errors
            }
        };
    }

    // Execute the skill
    // Reset execution state (input collection already started it, now we reset for execution)
    executionState.reset(skill.id);
    // Mark start node as completed (inputs phase done, execution starting)
    executionState.setTerminalStatus(skill.id, 'start', 'completed');

    const executionOptions = createExecutionOptions(ctx, inputsWithDefaults);

    try {
        const result = await skillExecutor.execute(skill, executionOptions);

        if (result.pendingConfirmation) {
            pendingStateManager.setPendingConfirmation(
                skill,
                result.context,
                result.pendingConfirmation.stepIndex,
                result.pendingConfirmation.options,
                result.steps,
                executionOptions
            );

            return {
                handled: true,
                metadata: {
                    command: 'skill_input',
                    skillId: skill.id,
                    pendingConfirmation: true,
                    stepId: result.pendingConfirmation.stepId
                }
            };
        }

        // Skill completed - deliver output to its sink, then finish the run (graph end-node)
        await finalizeSkillRun(ctx, skill, result);

        return {
            handled: true,
            metadata: {
                command: 'skill_input',
                skillId: skill.id,
                success: result.success,
                duration: result.duration
            }
        };

    } catch (error) {
        presenter.showExecutionError(stream, error);
        return {
            handled: true,
            metadata: {
                command: 'skill_input',
                skillId: skill.id,
                error: 'execution_failed'
            }
        };
    }
}

/**
 * Collect an input value and either prompt for next input or execute skill.
 * Returns CommandResult if there's a next input, null if should execute.
 */
function collectAndProceed(
    stream: vscode.ChatResponseStream,
    pendingStateManager: PendingStateManager,
    pending: PendingInputInfo,
    inputName: string,
    value: unknown,
    extraMeta?: Record<string, unknown>
): CommandResult | null {
    const nextInput = pendingStateManager.addCollectedInput(inputName, value);

    if (nextInput) {
        presenter.showInputPrompt(stream, nextInput);
        return {
            handled: true,
            metadata: {
                command: 'skill_input',
                skillId: pending!.skillId,
                // Re-stamp the ownership marker on every pending turn so resume
                // doesn't depend on the original /skill turn surviving in history
                // (mirrors confirmations; see extension.ts conversationInitiatedPending).
                pendingInput: true,
                collected: inputName,
                nextInput: nextInput.name,
                ...extraMeta
            }
        };
    }

    return null;
}

/**
 * Parse and validate enum input value.
 * Returns the resolved value, or error result if invalid.
 */
function parseEnumValue(
    stream: vscode.ChatResponseStream,
    input: SkillInput,
    userResponse: string,
    skillId: string
): { value: unknown; error?: CommandResult } {
    const enumValues = input.enum!;
    const numResponse = parseInt(userResponse, 10);

    if (!isNaN(numResponse) && numResponse >= 1 && numResponse <= enumValues.length) {
        return { value: enumValues[numResponse - 1] };
    }

    if (enumValues.includes(userResponse)) {
        return { value: userResponse };
    }

    presenter.showInvalidEnumError(stream, enumValues.length);
    presenter.showInputPrompt(stream, input);

    return {
        value: null,
        error: {
            handled: true,
            metadata: { command: 'skill_input', skillId, pendingInput: true, invalidEnum: true }
        }
    };
}

/**
 * Handle an input response from the user
 */
export async function handleInputResponse(ctx: CommandContext): Promise<CommandResult> {
    const { stream, pendingStateManager, executionState } = ctx;
    const userResponse = ctx.request.prompt.trim();

    const pending = pendingStateManager.getPendingInputCollection();
    if (!pending) {
        return { handled: false, metadata: {} };
    }

    const { skillId, currentInput } = pending;

    // Handle cancel
    if (userResponse.toLowerCase() === 'cancel') {
        pendingStateManager.clearPendingInputCollection();
        presenter.showSkillCancelled(stream, skillId, 'input');

        // Clear any active graph highlighting from the input collection phase.
        executionState.reset(skillId);
        executionState.finishExecution(skillId, false);
        return { handled: true, metadata: { command: 'skill_input', skillId, action: 'cancel' } };
    }

    // Empty response with default -> use default
    if (userResponse === '' && currentInput.default !== undefined) {
        presenter.showUsingDefault(stream, currentInput.default);
        const result = collectAndProceed(stream, pendingStateManager, pending, currentInput.name, currentInput.default, { usedDefault: true });
        return result ?? await executeAfterInputCollection(ctx, pending);
    }

    // Empty response, required, no default -> error
    if (userResponse === '' && currentInput.required) {
        presenter.showRequiredInputError(stream, currentInput.name);
        presenter.showInputPrompt(stream, currentInput);
        return { handled: true, metadata: { command: 'skill_input', skillId, pendingInput: true, emptyRequired: true } };
    }

    // Empty response, optional, no default -> skip
    if (userResponse === '') {
        presenter.showSkipped(stream);
        const result = collectAndProceed(stream, pendingStateManager, pending, currentInput.name, undefined, { skipped: true });
        return result ?? await executeAfterInputCollection(ctx, pending);
    }

    // Parse value based on input type
    let value: unknown;

    if (currentInput.enum && currentInput.enum.length > 0) {
        const parsed = parseEnumValue(stream, currentInput, userResponse, skillId);
        if (parsed.error) return parsed.error;
        value = parsed.value;
    } else {
        value = coerceValue(userResponse, currentInput.type);
    }

    // Validate using shared validation logic (handles pattern, type, enum)
    const validation = validateSingleInput(currentInput, value);
    if (!validation.valid) {
        presenter.showInvalidFormatError(stream);
        presenter.showInputPrompt(stream, currentInput);
        return { handled: true, metadata: { command: 'skill_input', skillId, pendingInput: true, invalidFormat: true } };
    }

    // Collect value and proceed
    presenter.showGotIt(stream);
    const result = collectAndProceed(stream, pendingStateManager, pending, currentInput.name, value);
    return result ?? await executeAfterInputCollection(ctx, pending);
}

/**
 * Check if there's a pending input collection
 */
export function checkPendingInputCollection(
    stream: vscode.ChatResponseStream,
    pendingStateManager: PendingStateManager
): boolean {
    if (pendingStateManager.hasPendingInputCollection()) {
        const pending = pendingStateManager.getPendingInputCollection();
        if (pending) {
            presenter.showPendingInput(stream, pending.skillId, pending.currentInput);
            return true;
        }
    }
    return false;
}
