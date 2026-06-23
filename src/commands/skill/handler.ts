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
    resolveContextInputs,
    resolveInputs,
    validateSingleInput,
    captureDeliveryTarget,
    outputNeedsTarget,
    hasValue
} from '../../skills';
import type { Skill, EditorContextSnapshot, LaunchContextStore } from '../../skills';
import { parseArgs, mapPositionalArgs, coerceValue } from './argument-parser';
import { createExecutionOptions } from './execution-options';
import { finalizeSkillRun } from './finalize';
import * as presenter from './presenter';

/**
 * Resolve editor-context inputs at launch: prefer a snapshot stashed by an
 * editor trigger (captured at trigger time, before chat focus moved); otherwise
 * capture live (the chat-typed path). `captureLive` is injectable for tests.
 */
export async function resolveLaunchInputs(
    skill: Skill,
    inputs: Record<string, unknown>,
    launchContextStore?: LaunchContextStore,
    captureLive: (skill: Skill, inputs: Record<string, unknown>) => Promise<Record<string, unknown>>
        = resolveContextInputs,
): Promise<Record<string, unknown>> {
    const stashed: EditorContextSnapshot | undefined = launchContextStore?.take(skill.id);
    const resolved = stashed
        ? resolveInputs(skill, inputs, stashed)
        : await captureLive(skill, inputs);
    return normalizeContextInputs(skill, inputs, resolved);
}

/**
 * Reconcile `from:`-filled values with their input definition:
 *  - coerce a raw context string to the input's declared type (number/boolean/array), and
 *  - drop a context value the input would reject (enum/pattern/type) so a triggered run
 *    falls back to its normal prompt/skip flow instead of hard-failing validation for data
 *    the user never typed.
 * Only values the context actually supplied (the input was originally empty) are touched —
 * an explicit arg or a default always wins.
 */
function normalizeContextInputs(
    skill: Skill,
    original: Record<string, unknown>,
    resolved: Record<string, unknown>
): Record<string, unknown> {
    const out = { ...resolved };
    for (const input of skill.inputs) {
        if (!input.from) continue;
        if (hasValue(original[input.name])) continue; // explicit arg / default wins
        let value = out[input.name];
        if (!hasValue(value)) continue; // context supplied nothing
        if (typeof value === 'string') {
            // Validate the RAW context string before coercing. validateSingleInput is
            // coercion-aware (a numeric/boolean string passes, a junk string fails), so a
            // code selection bound to a number/boolean/enum input is dropped here rather
            // than being silently mangled by coerceValue (which turns any non-boolean into
            // `false` and any string into an array — values that would then always validate).
            // Arrays are the exception: the validator has no string→array rule, so the
            // comma-split happens up front and the resulting array is validated below.
            if (input.type === 'array') {
                value = coerceValue(value, 'array');
            } else if (!validateSingleInput(input, value).valid) {
                delete out[input.name];
                continue;
            } else {
                value = coerceValue(value, input.type);
            }
        }
        if (validateSingleInput(input, value).valid) {
            out[input.name] = value;
        } else {
            delete out[input.name];
        }
    }
    return out;
}

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
    const { stream, skillRegistry, skillExecutor, pendingStateManager, executionState } = ctx;

    // Parse arguments
    const { skillId, params } = parseArgs(ctx.request.prompt);

    if (!skillId) {
        presenter.showUsage(stream);
        return { handled: true, metadata: { command: 'skill', error: 'no_skill_id' } };
    }

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
        const liveTarget = captureDeliveryTarget();
        if (liveTarget) ctx.launchContextStore.setTarget(skill.id, liveTarget);
    }

    // Determine which inputs need to be prompted
    const inputsToPrompt = skill.inputs.filter(input => {
        const value = inputsWithDefaults[input.name];
        const wasExplicitlyProvided = input.name in mappedInputs;
        const present = hasValue(value);

        if (input.required && !present) {
            return true;
        }

        // A from:-bound input filled from editor context counts as provided —
        // don't re-prompt for data the trigger already captured.
        const filledFromContext = !!input.from && !wasExplicitlyProvided && present;

        return !!(input.prompt && !wasExplicitlyProvided && !filledFromContext);
    });

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
