/**
 * /skill Command Handler
 *
 * Main orchestration for skill execution.
 * Delegates argument parsing, input collection, and confirmation handling
 * to specialized modules.
 *
 * Single Responsibility: Orchestrate skill execution flow.
 */

import { CommandContext, CommandResult } from '../types';
import {
    validateSkill,
    formatValidationResult,
    validateInputs,
    applyDefaults,
    checkReadiness,
    parseSkill,
    resolveLaunchInputs,
    inputsToAsk,
    captureDeliveryTarget,
    outputNeedsTarget
} from '../../skills';
import { parseArgs, mapPositionalArgs } from './argument-parser';
import { createExecutionOptions } from './execution-options';
import { finalizeSkillRun } from './finalize';
import * as presenter from './presenter';

/**
 * Handle /skill command - execute a skill
 *
 * Flow:
 * 1. Parse arguments
 * 2. Find and validate skill
 * 3. Check MCP requirements
 * 4. Map and validate inputs
 * 5. Start input collection if needed, or execute directly
 */
export async function handleSkill(ctx: CommandContext): Promise<CommandResult> {
    // Parse arguments
    const { skillId, params } = parseArgs(ctx.request.prompt);

    if (!skillId) {
        presenter.showUsage(ctx.stream);
        return { handled: true, metadata: { command: 'skill', error: 'no_skill_id' } };
    }

    return runSkillById(ctx, skillId, params);
}

/**
 * Run a skill by id with already-parsed params (everything `/skill` does after
 * argument parsing). Shared by `/skill` and by commands that launch a skill
 * programmatically (e.g. `/new` → skill-creator).
 */
export async function runSkillById(
    ctx: CommandContext,
    skillId: string,
    params: Record<string, string>
): Promise<CommandResult> {
    const { stream, skillRegistry, skillExecutor, pendingStateManager, executionState } = ctx;

    // Find the skill (cache lookup for path only)
    const cachedSkill = skillRegistry.getById(skillId);

    if (!cachedSkill) {
        presenter.showSkillNotFound(stream, skillId);
        return { handled: true, metadata: { command: 'skill', error: 'not_found' } };
    }

    // Fresh parse from disk - ensures we validate current file content
    const parseResult = await parseSkill(cachedSkill.source.path, cachedSkill.source);

    if (!parseResult.success) {
        presenter.showSkillValidationFailed(stream, parseResult.error.error);
        return {
            handled: true,
            metadata: {
                command: 'skill',
                skillId,
                error: 'parse_error',
                message: parseResult.error.error
            }
        };
    }

    const skill = parseResult.skill;

    // Validate skill definition before execution (async for file I/O compatibility)
    const skillValidation = await validateSkill(skill);
    if (!skillValidation.valid) {
        presenter.showSkillValidationFailed(stream, formatValidationResult(skill.id, skillValidation));
        return {
            handled: true,
            metadata: {
                command: 'skill',
                skillId: skill.id,
                error: 'validation_failed',
                errors: skillValidation.errors.map(e => e.message)
            }
        };
    }

    // Check execution readiness (tool availability)
    const readiness = checkReadiness(skill, {});

    if (!readiness.canRun) {
        presenter.showReadinessErrors(stream, skill.id, readiness);
        return {
            handled: true,
            metadata: {
                command: 'skill',
                error: 'not_ready',
                errors: readiness.errors.map(e => e.message)
            }
        };
    }

    // Show warnings if any (but don't block execution)
    if (readiness.warnings.length > 0) {
        presenter.showReadinessWarnings(stream, readiness.warnings);
    }

    // Map and validate inputs
    const mappedInputs = mapPositionalArgs(skill, params);
    const withDefaults = applyDefaults(skill, mappedInputs);
    // A2: fill inputs bound to editor context (selection/file/diff/diagnostics).
    // No-op (same object, no editor read) when no input declares `from:`.
    const inputsWithDefaults = await resolveLaunchInputs(skill, withDefaults, ctx.launchContextStore);

    // Editor write-back sinks (replaceSelection/insert/diff) deliver to the launch
    // target. A trigger already stashed one; for a chat-typed run with such a sink,
    // capture the current editor now so the sink has a target. Sinks that ignore the
    // target (newDocument/file/terminal) and the common no-`output.to` case need none,
    // so skip the editor read and store write entirely.
    if (outputNeedsTarget(skill.output?.to) && ctx.launchContextStore && !ctx.launchContextStore.hasTarget(skill.id)) {
        const liveTarget = captureDeliveryTarget({ excludeDir: skill.source.path });
        if (liveTarget) ctx.launchContextStore.setTarget(skill.id, liveTarget);
    }

    // Determine which inputs need to be prompted
    const inputsToPrompt = inputsToAsk(skill, mappedInputs, inputsWithDefaults);

    // If there are inputs to prompt, start interactive collection
    if (inputsToPrompt.length > 0) {
        const firstInput = inputsToPrompt[0];
        const remainingInputs = inputsToPrompt.slice(1);

        pendingStateManager.setPendingInputCollection(skill, inputsWithDefaults, firstInput, remainingInputs);

        // Start execution tracking and highlight start node (input collection phase)
        executionState.startExecution(skill.id, skill.steps.map(s => s.id));
        executionState.setTerminalStatus(skill.id, 'start', 'active');

        presenter.showSkillStarting(stream, skill.name);
        presenter.showInputPrompt(stream, firstInput);

        return {
            handled: true,
            metadata: {
                command: 'skill',
                skillId: skill.id,
                pendingInput: true,
                inputName: firstInput.name
            }
        };
    }

    // All inputs provided - validate them
    const validation = validateInputs(skill, inputsWithDefaults);

    if (!validation.valid) {
        presenter.showInvalidInputs(stream, validation.errors);
        return {
            handled: true,
            metadata: {
                command: 'skill',
                error: 'invalid_inputs',
                errors: validation.errors
            }
        };
    }

    // Execute the skill
    presenter.showSkillStarting(stream, skill.name);

    // Start/reset execution state tracking
    executionState.startExecution(skill.id, skill.steps.map(s => s.id));
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
                    command: 'skill',
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
                command: 'skill',
                skillId: skill.id,
                success: result.success,
                duration: result.duration,
                stepsCompleted: result.steps.filter(s => s.success).length,
                totalSteps: result.steps.length
            }
        };

    } catch (error) {
        presenter.showExecutionError(stream, error);
        return {
            handled: true,
            metadata: {
                command: 'skill',
                error: 'execution_failed',
                message: error instanceof Error ? error.message : String(error)
            }
        };
    }
}
