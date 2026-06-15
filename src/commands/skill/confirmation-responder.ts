/**
 * Confirmation Responder
 *
 * Handles user responses to confirmation steps.
 * Parses responses, manages state transitions, and resumes execution.
 *
 * Single Responsibility: Process confirmation responses and resume skill execution.
 */

import * as vscode from 'vscode';
import { CommandContext, CommandResult } from '../types';
import {
    PendingStateManager,
    parseConfirmationResponse
} from '../../skills';
import { createExecutionOptions } from './execution-options';
import * as presenter from './presenter';

/**
 * Handle a confirmation response from the user
 */
export async function handleConfirmationResponse(ctx: CommandContext): Promise<CommandResult> {
    const { stream, pendingStateManager, skillExecutor, executionState } = ctx;
    const userResponse = ctx.request.prompt.trim();

    const pending = pendingStateManager.getPendingConfirmation();
    if (!pending) {
        return { handled: false, metadata: {} };
    }

    // Parse the user's response
    const selectedOption = parseConfirmationResponse(userResponse, pending.options);

    if (!selectedOption) {
        presenter.showInvalidConfirmationResponse(stream, pending.skillId, pending.options);
        return {
            handled: true,
            metadata: {
                command: 'skill_confirmation',
                skillId: pending.skillId,
                invalidResponse: true
            }
        };
    }

    // Handle abort action - clear state after handling
    if (selectedOption.action === 'abort') {
        pendingStateManager.clearPendingConfirmation();
        presenter.showSkillCancelled(
            stream,
            pending.skillId,
            'confirmation',
            pending.skill.steps[pending.pendingStepIndex].id
        );

        // Ensure graph highlighting doesn't remain stuck in an active state.
        // On abort we want to *finish* the current run visually (keep the trail),
        // so we emit explicit status updates instead of resetting highlights.
        const confirmationStepId = pending.skill.steps[pending.pendingStepIndex]?.id;
        if (confirmationStepId) {
            executionState.setStepStatus(pending.skillId, confirmationStepId, 'completed');
        }
        executionState.setTerminalStatus(pending.skillId, 'end', 'completed');
        executionState.finishExecution(pending.skillId, false);
        return {
            handled: true,
            metadata: {
                command: 'skill_confirmation',
                skillId: pending.skillId,
                action: 'abort'
            }
        };
    }

    // Capture the confirmation choice as this step's output. The executor writes
    // it AND marks the answered step completed (single owner of resume-time
    // context + state mutation); the command layer passes intent, not pokes.
    const confirmationStep = pending.skill.steps[pending.pendingStepIndex];
    const confirmationStepId = confirmationStep?.id;
    const recordOutput = confirmationStep.output
        ? {
            key: confirmationStep.output,
            value: {
                selectedOption: selectedOption.label,
                selectedIndex: pending.options.indexOf(selectedOption) + 1,
                action: selectedOption.action,
                timestamp: Date.now()
            }
        }
        : undefined;

    // Determine which step to resume from
    let resumeFromStep: number;

    presenter.showResuming(stream, pending.skillId);

    if (selectedOption.action === 'goto' && selectedOption.gotoStep) {
        const gotoIndex = pending.skill.steps.findIndex(s => s.id === selectedOption.gotoStep);
        if (gotoIndex >= 0) {
            resumeFromStep = gotoIndex;
            presenter.showSelectedOption(stream, selectedOption.label, selectedOption.gotoStep);
        } else {
            presenter.showStepNotFound(stream, selectedOption.gotoStep);
            resumeFromStep = pending.pendingStepIndex + 1;
        }
    } else {
        resumeFromStep = pending.pendingStepIndex + 1;
        presenter.showSelectedOption(stream, selectedOption.label);
    }

    // Clear pending state (pending is a local reference, safe to use after clearing instance)
    pendingStateManager.clearPendingConfirmation();

    // Resume skill execution (uses current model from dropdown, allowing mid-skill switching).
    // The executor marks the answered confirmation step completed (via completedStepId)
    // as part of resume preparation — no direct execution-state mutation here.
    const executionOptions = createExecutionOptions(ctx, pending.context.inputs);

    const resumeOptions = {
        startFromStep: resumeFromStep,
        existingContext: pending.context,
        existingStepResults: pending.stepResults,
        recordOutput,
        completedStepId: confirmationStepId
    };

    try {
        const result = await skillExecutor.execute(pending.skill, executionOptions, resumeOptions);

        if (result.pendingConfirmation) {
            pendingStateManager.setPendingConfirmation(
                pending.skill,
                result.context,
                result.pendingConfirmation.stepIndex,
                result.pendingConfirmation.options,
                result.steps,
                executionOptions
            );

            return {
                handled: true,
                metadata: {
                    command: 'skill_confirmation',
                    skillId: pending.skillId,
                    pendingConfirmation: true,
                    stepId: result.pendingConfirmation.stepId
                }
            };
        }

        // Skill completed - highlight end node with animation
        executionState.finishExecution(pending.skillId, result.success);

        return {
            handled: true,
            metadata: {
                command: 'skill_confirmation',
                skillId: pending.skillId,
                success: result.success,
                duration: result.duration
            }
        };

    } catch (error) {
        presenter.showExecutionError(stream, error);
        return {
            handled: true,
            metadata: {
                command: 'skill_confirmation',
                skillId: pending.skillId,
                error: 'execution_failed'
            }
        };
    }
}

/**
 * Check if there's a pending confirmation that should block new skill execution
 */
export function checkPendingConfirmation(
    stream: vscode.ChatResponseStream,
    pendingStateManager: PendingStateManager
): boolean {
    if (pendingStateManager.hasPendingConfirmation()) {
        const pending = pendingStateManager.getPendingConfirmation();
        if (pending) {
            presenter.showPendingConfirmation(
                stream,
                pending.skillId,
                pending.skill.steps[pending.pendingStepIndex].id,
                pending.options
            );
            return true;
        }
    }
    return false;
}
