/**
 * Skill Executor Class
 *
 * Executes skills step-by-step with LLM and MCP tool integration.
 * Manages context passing between steps and handles errors.
 *
 * Uses Strategy pattern for step handling - each step type has its own handler.
 * The executor orchestrates: condition evaluation, handler dispatch, result collection.
 *
 * Architecture:
 * - Single point of state mutation (context updates, execution state)
 * - All UI rendering through ProgressHooks (no direct stream access)
 * - Result building delegated to SkillResultBuilder
 * - Static dependencies injected via constructor (DIP compliance)
 * - Per-execution dependencies created in execute() (they depend on execution-specific data)
 */

import type {
    Skill,
    SkillStep,
    ExecutionContext,
    StepResult,
    SkillResult,
    ExecutionOptions,
    ParsedStep,
    ResumeOptions,
    ResolvedModel
} from './types';
import type { ProgressHooks } from './progress-hooks';
import { loadSkillSteps } from './parser';
import { interpolate, evaluateCondition } from './interpolation';
import { buildStepInspection } from './step-inspection';
import type { ExecutionStateManager } from './execution-state';
import { createStreamProgressHooks } from './progress-hooks';
import { SkillResultBuilder } from './result-builder';
import { createToolResolver } from './tool-resolver';
import { createModelResolver, type ModelResolver } from './model-resolver';
import {
    createDefaultRegistry,
    stepContextFactory,
    StepHandlerRegistry,
    ContextUpdates,
    HandlerStepStatus,
    HandlerResult
} from './handlers';

/**
 * Outcome of processing a single step
 *
 * Used by processStep to communicate whether the main loop should
 * continue to the next step or return early with a final result.
 */
interface StepOutcome {
    /** How to proceed after this step: 'continue' advances to the next step
     *  (success, continued-failure, or skip — the step STATUS distinguishes
     *  them); 'return' ends the skill (abort or pending confirmation). */
    action: 'continue' | 'return';
    /** If action is 'return', this is the final skill result */
    skillResult?: SkillResult;
}

/**
 * Context for step processing operations
 *
 * Contains only what processStep and related methods need.
 */
interface StepProcessingContext {
    skill: Skill;
    context: ExecutionContext;
    hooks: ProgressHooks;
    registry: StepHandlerRegistry;
    stepPrompts: Map<string, ParsedStep>;
    options: ExecutionOptions;
    stepResults: StepResult[];
    resultBuilder: SkillResultBuilder;
    executionState: ExecutionStateManager;
    /** Model resolver for per-step model selection */
    modelResolver: ModelResolver;
    /** Whether user's dropdown is set to Auto (skill controls model) */
    isAutoMode: boolean;
}

/**
 * Skill Executor class for running skills step-by-step.
 *
 * Encapsulates skill execution logic with progress reporting.
 *
 * Responsibilities:
 * - Step loop orchestration
 * - Condition evaluation (skip handling)
 * - Handler dispatch via registry
 * - Context mutation (single point)
 * - Execution state updates (single point)
 */
export class SkillExecutor {
    /**
     * Create a skill executor with injected dependencies.
     *
     * @param registry - Handler registry for step dispatch
     * @param modelResolver - Resolver for per-step model selection
     */
    constructor(
        private readonly registry: StepHandlerRegistry,
        private readonly modelResolver: ModelResolver
    ) {}
    /**
     * Execute a skill with the given options
     * @param skill The skill to execute
     * @param options Execution options
     * @param resumeOptions Optional options for resuming from a specific step
     */
    async execute(
        skill: Skill,
        options: ExecutionOptions,
        resumeOptions?: ResumeOptions
    ): Promise<SkillResult> {
        const startTime = resumeOptions?.existingContext.startTime ?? Date.now();
        const startFromStep = resumeOptions?.startFromStep ?? 0;

        // Initialize or reuse execution context
        const context: ExecutionContext = resumeOptions?.existingContext ?? {
            inputs: options.inputs,
            outputs: {},
            currentStep: 0,
            totalSteps: skill.steps.length,
            skill,
            startTime,
            stepTimes: {},
            availableMcps: options.availableMcps
        };

        // Load all step prompts (async for remote/virtual FS compatibility)
        const stepPrompts = await loadSkillSteps(skill);

        // Results for each step (reuse existing if resuming)
        let stepResults: StepResult[] = resumeOptions?.existingStepResults ?? [];

        // Create progress hooks for UI rendering (per-execution, depends on stream/verboseMode)
        const hooks = createStreamProgressHooks(options.stream, options.verboseMode ?? 'off');

        // Use pre-computed auto mode flag from command context
        // Auto mode = skill controls model selection
        // Specific mode = user override, always use their choice
        const autoMode = options.isAutoMode;

        // Create result builder for this execution
        const resultBuilder = new SkillResultBuilder(skill.id, startTime);

        // Get execution state from options (required via DI)
        const { executionState } = options;

        // Ensure execution state is initialized for this skill
        // This is defensive - normally command handler calls startExecution,
        // but executor should work correctly even if called directly
        if (!executionState.hasState(skill.id)) {
            // Compute model override for graph display (when user selects specific model)
            const modelOverride = !autoMode ? {
                displayName: this.modelResolver.extractDisplayName(options.model.id),
                modelId: options.model.id
            } : undefined;
            executionState.startExecution(skill.id, skill.steps.map(s => s.id), { modelOverride });
        }

        // On resume, prune records for steps that will re-run and reset their
        // graph status, so a backward `goto` neither duplicates step results nor
        // leaves stale "completed" highlights. Also records any pending output
        // (e.g. the confirmation choice) through the executor's single mutation point.
        if (resumeOptions) {
            stepResults = this.prepareResume(skill, context, stepResults, resumeOptions, executionState);
        }

        // Create processing context for helper methods
        const processingCtx: StepProcessingContext = {
            skill,
            context,
            hooks,
            registry: this.registry,
            stepPrompts,
            options,
            stepResults,
            resultBuilder,
            executionState,
            modelResolver: this.modelResolver,
            isAutoMode: autoMode
        };

        try {
            // Execute each step sequentially (starting from startFromStep)
            for (let i = startFromStep; i < skill.steps.length; i++) {
                const step = skill.steps[i];
                context.currentStep = i;

                const outcome = await this.processStep(processingCtx, step, i);

                // Handle outcome
                if (outcome.action === 'return' && outcome.skillResult) {
                    return outcome.skillResult;
                }
                // 'continue' proceeds to the next iteration
            }

            // All steps completed - finalize execution
            return this.finalizeExecution(processingCtx);

        } catch (error) {
            return this.handleExecutionError(processingCtx, error);
        }
    }

    /**
     * Prepare execution state for a resumed run.
     *
     * On resume (e.g. after a confirmation), steps from `startFromStep` onward
     * are re-run. To keep records correct and the graph honest, this:
     * - drops step results for steps that will re-run (avoids duplicates),
     * - resets their timings and graph status to 'pending',
     * - PRESERVES their accumulated outputs, so a looping step can read what it
     *   produced last iteration (each re-running step overwrites its own output);
     *   deleting them would wipe loop-carried state on every backward `goto`,
     * - records any pending output (e.g. the confirmation choice) as the single
     *   point of context mutation,
     * - marks the answered step (e.g. a confirmation) 'completed' when it sits
     *   outside the re-run window, so the command layer never touches state directly.
     *
     * @returns the pruned step-results array to continue with
     */
    private prepareResume(
        skill: Skill,
        context: ExecutionContext,
        existingStepResults: StepResult[],
        resume: ResumeOptions,
        executionState: ExecutionStateManager
    ): StepResult[] {
        const startIdx = resume.startFromStep;
        const indexById = new Map(skill.steps.map((s, i) => [s.id, i] as const));

        // Drop results for steps that will re-run so they aren't double-counted.
        const pruned = existingStepResults.filter(result => {
            const idx = indexById.get(result.stepId);
            return idx === undefined || idx < startIdx;
        });

        // Reset timings and graph status for the re-run window. Outputs are
        // intentionally NOT deleted: each re-running step overwrites its own
        // output, and preserving the prior values lets a looping step read what
        // it produced last iteration (the documented "carry state forward in
        // outputs" pattern). Wiping them here broke backward `goto` loops by
        // clearing loop-carried state before the step re-rendered.
        for (let i = startIdx; i < skill.steps.length; i++) {
            const step = skill.steps[i];
            delete context.stepTimes[step.id];
            executionState.setStepStatus(skill.id, step.id, 'pending');
        }

        // Record any pending output (e.g. the confirmation choice), overwriting
        // the prior iteration's value so the re-run renders against the latest answer.
        if (resume.recordOutput) {
            context.outputs[resume.recordOutput.key] = resume.recordOutput.value;
        }

        // Mark the answered step 'completed' only when it's outside the re-run
        // window (e.g. a forward resume past a confirmation). If it's within the
        // window (a backward goto), the reset above already set it 'pending' and
        // it will re-run.
        if (resume.completedStepId) {
            const completedIdx = indexById.get(resume.completedStepId);
            if (completedIdx !== undefined && completedIdx < startIdx) {
                executionState.setStepStatus(skill.id, resume.completedStepId, 'completed');
            }
        }

        return pruned;
    }

    /**
     * Finalize successful execution - generate summary and return result
     */
    private finalizeExecution(ctx: StepProcessingContext): SkillResult {
        // Generate summary if output template exists
        let summary: string | undefined;
        if (ctx.skill.output?.summary) {
            summary = interpolate(ctx.skill.output.summary, ctx.context);
        }

        // Notify via hook (UI rendering delegated to hooks). When output is routed
        // to a sink, suppress the raw chat echo — the sink delivery reports its own
        // confirmation; chat-only skills (no output.to) still echo the summary.
        const duration = Date.now() - ctx.context.startTime;
        const echoSummary = ctx.skill.output?.to ? undefined : summary;
        ctx.hooks.onSkillComplete?.(duration, echoSummary);

        return ctx.resultBuilder.success(ctx.stepResults, ctx.context, summary);
    }

    /**
     * Handle unexpected execution error
     */
    private handleExecutionError(ctx: StepProcessingContext, error: unknown): SkillResult {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Build step context info for error display
        const currentStep = ctx.skill.steps[ctx.context.currentStep];
        let stepContext: string | undefined;
        if (currentStep?.file) {
            stepContext = `**Step file:** \`${currentStep.file}\``;
        } else if (currentStep?.id) {
            stepContext = `**Step:** \`${currentStep.id}\``;
        }

        // Notify via hook (UI rendering delegated to hooks)
        ctx.hooks.onSkillError?.(errorMessage, stepContext);

        return ctx.resultBuilder.error(ctx.stepResults, ctx.context, errorMessage);
    }

    /**
     * Handle a skipped step (condition not met)
     *
     * This is an executor concern, not a handler, because:
     * - Condition evaluation is orchestration logic
     * - Skipping bypasses all handlers entirely
     */
    private handleSkip(
        ctx: StepProcessingContext,
        step: SkillStep,
        stepIndex: number
    ): StepOutcome {
        const skipReason = `Condition not met: ${step.when}`;
        const skipResult: StepResult = {
            stepId: step.id,
            success: true,
            skipped: true,
            skipReason,
            duration: 0
        };

        ctx.stepResults.push(skipResult);

        // Update execution state (single point of mutation)
        ctx.executionState.setStepStatus(ctx.skill.id, step.id, 'skipped');

        // Notify via hook
        ctx.hooks.onStepSkipped?.(step.id, stepIndex, ctx.skill.steps.length, skipReason);

        // Skip is conveyed by the 'skipped' status above; the loop just advances.
        return { action: 'continue' };
    }

    /**
     * Apply context updates from handler result
     *
     * Handlers return updates instead of mutating directly.
     * Executor applies updates to maintain single point of mutation.
     */
    private applyContextUpdates(
        ctx: StepProcessingContext,
        step: SkillStep,
        updates: ContextUpdates | undefined
    ): void {
        if (!updates) return;

        // Apply output if step defines output key
        if (step.output && updates.output !== undefined) {
            ctx.context.outputs[step.output] = updates.output;
        }

        // Apply timing
        if (updates.stepTime !== undefined) {
            ctx.context.stepTimes[step.id] = updates.stepTime;
        }
    }

    /**
     * Apply status update from handler result
     *
     * Handlers return status instead of calling executionState directly.
     * Executor applies status to maintain single point of state mutation.
     */
    private applyStatusUpdate(
        ctx: StepProcessingContext,
        step: SkillStep,
        status: HandlerStepStatus | undefined
    ): void {
        if (status) {
            ctx.executionState.setStepStatus(ctx.skill.id, step.id, status);
        }
    }

    /**
     * Process a single step using the handler registry (Strategy pattern)
     *
     * Orchestrates:
     * 1. Cancellation check
     * 2. Condition evaluation (skip handling)
     * 3. Handler dispatch via registry
     * 4. Status update (single point of mutation)
     * 5. Context update (single point of mutation)
     * 6. Result collection
     * 7. Debug-data capture (prompt/response) for prompt-bearing steps
     *
     * Each step type has its own handler with single responsibility.
     */
    private async processStep(
        ctx: StepProcessingContext,
        step: SkillStep,
        stepIndex: number
    ): Promise<StepOutcome> {
        // Check cancellation
        if (ctx.options.token.isCancellationRequested) {
            return {
                action: 'return',
                skillResult: ctx.resultBuilder.cancelled(ctx.stepResults, ctx.context)
            };
        }

        // Mark step as active before condition check
        // This triggers auto-complete of the previous step in ExecutionStateEmitter.
        // For handlers that use models, model info is added after resolution.
        ctx.executionState.setStepStatus(ctx.skill.id, step.id, 'active');

        // Check conditional execution (orchestration concern)
        if (step.when) {
            const shouldRun = evaluateCondition(step.when, ctx.context);
            if (!shouldRun) {
                return this.handleSkip(ctx, step, stepIndex);
            }
        }

        // Find handler for this step type
        const handler = ctx.registry.findHandler(step);
        if (!handler) {
            return this.handleNoHandler(ctx, step);
        }

        // LLM resolution based on handler capability
        // Handlers declare usesLLM: true/false to indicate their needs
        let resolvedModel: ResolvedModel | undefined;
        let result: HandlerResult;

        // Model resolution and handler dispatch can throw (e.g. no model
        // available). Route any throw through the skill's onError strategy so
        // it behaves consistently with handler-returned failures.
        try {
            if (handler.usesLLM) {
                resolvedModel = await ctx.modelResolver.resolve(
                    step.model,
                    ctx.skill.models?.aliases,
                    ctx.skill.models?.default,
                    ctx.options.model,
                    ctx.isAutoMode
                );

                // Update execution state with model info (for graph badge display)
                ctx.executionState.setStepStatus(ctx.skill.id, step.id, 'active', {
                    model: { displayName: resolvedModel.displayName, source: resolvedModel.source }
                });

                // Show fallback warning if model was unavailable
                if (resolvedModel.usedFallback && resolvedModel.requestedModel) {
                    ctx.hooks.onModelFallback?.(
                        step.id,
                        resolvedModel.requestedModel,
                        resolvedModel.displayName
                    );
                }

                // Report step start with model info
                ctx.hooks.onStepStart?.(
                    step.id,
                    stepIndex,
                    ctx.skill.steps.length,
                    { displayName: resolvedModel.displayName, source: resolvedModel.source }
                );
            } else {
                // Handler doesn't use LLM: report start without model info
                ctx.hooks.onStepStart?.(step.id, stepIndex, ctx.skill.steps.length);
            }

            // Create immutable context for handler
            const parsedStep = ctx.stepPrompts.get(step.id);
            const stepContext = stepContextFactory.create(
                ctx.skill,
                step,
                stepIndex,
                parsedStep,
                ctx.context,
                {
                    token: ctx.options.token,
                    toolToken: ctx.options.toolToken,
                    model: ctx.options.model,
                    resolvedModel,
                    verboseMode: ctx.options.verboseMode ?? 'off'
                },
                ctx.context.startTime,
                ctx.stepResults
            );

            // Execute handler
            result = await handler.handle(stepContext, ctx.hooks);
        } catch (error) {
            return this.handleStepError(ctx, step, error);
        }

        // Apply status update (single point of mutation)
        this.applyStatusUpdate(ctx, step, result.statusUpdate);

        // Apply context updates (single point of mutation)
        this.applyContextUpdates(ctx, step, result.contextUpdates);

        // Collect results
        if (result.stepResult) {
            // Add model info to step results when handler uses LLM (executor responsibility)
            if (handler.usesLLM && resolvedModel) {
                result.stepResult.modelUsed = resolvedModel.model.id;
            }

            ctx.stepResults.push(result.stepResult);

            // Capture step I/O (interpolated prompt + response) for the graph
            // inspector. The handler is the authority on whether its steps are
            // inspectable (inspectionKind); the data is session-scoped and lives
            // alongside execution status.
            if (handler.inspectionKind) {
                ctx.executionState.recordStepInspection(
                    ctx.skill.id,
                    step.id,
                    buildStepInspection(result.stepResult, handler.inspectionKind)
                );
            }

            // Report completion via hook (unless handler opts out)
            if (result.reportCompletion !== false) {
                ctx.hooks.onStepComplete?.(
                    step.id,
                    result.stepResult.success,
                    result.stepResult.duration,
                    result.stepResult.error
                );
            }
        }

        // Build skill result for confirmation steps (has pending info)
        if (result.action === 'return' && result.pendingConfirmation) {
            return {
                action: 'return',
                skillResult: ctx.resultBuilder.pendingConfirmation(
                    ctx.stepResults,
                    ctx.context,
                    result.pendingConfirmation
                )
            };
        }

        // Build skill result for error abort cases
        if (result.action === 'return' && result.stepResult && !result.stepResult.success) {
            return {
                action: 'return',
                skillResult: ctx.resultBuilder.error(
                    ctx.stepResults,
                    ctx.context,
                    result.stepResult.error || 'Step failed'
                )
            };
        }

        return {
            action: result.action,
            skillResult: result.skillResult
        };
    }

    /**
     * Handle an error thrown during step processing (model resolution or handler
     * dispatch), honoring the skill's onError strategy.
     *
     * Without this, a throw (e.g. "no model available") propagated to the
     * top-level catch and aborted the whole skill regardless of `onError`.
     */
    private handleStepError(
        ctx: StepProcessingContext,
        step: SkillStep,
        error: unknown
    ): StepOutcome {
        const message = error instanceof Error ? error.message : String(error);

        const errorResult: StepResult = {
            stepId: step.id,
            success: false,
            error: message,
            duration: 0
        };

        ctx.stepResults.push(errorResult);

        // Update execution state (single point of mutation)
        ctx.executionState.setStepStatus(ctx.skill.id, step.id, 'error');

        // Notify via hook
        ctx.hooks.onStepComplete?.(step.id, false, 0, message);

        if (ctx.skill.onError === 'abort') {
            return {
                action: 'return',
                skillResult: ctx.resultBuilder.error(ctx.stepResults, ctx.context, message)
            };
        }

        return { action: 'continue' };
    }

    /**
     * Handle case where no handler is found for step type
     */
    private handleNoHandler(ctx: StepProcessingContext, step: SkillStep): StepOutcome {
        const stepType = step.type || 'default';
        const errorMessage = `No handler found for step type: ${stepType}`;

        const errorResult: StepResult = {
            stepId: step.id,
            success: false,
            error: errorMessage,
            duration: 0
        };

        ctx.stepResults.push(errorResult);

        // Update execution state (single point of mutation)
        ctx.executionState.setStepStatus(ctx.skill.id, step.id, 'error');

        // Notify via hook
        ctx.hooks.onNoHandler?.(step.id, stepType);

        if (ctx.skill.onError === 'abort') {
            return {
                action: 'return',
                skillResult: ctx.resultBuilder.error(
                    ctx.stepResults,
                    ctx.context,
                    errorMessage
                )
            };
        }

        // Failure under onError:continue — advance like any other continued failure.
        return { action: 'continue' };
    }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a skill executor with default dependency wiring.
 *
 * This factory handles the creation of static dependencies:
 * - ToolResolver for MCP tool lookup
 * - StepHandlerRegistry with all default handlers
 * - ModelResolver for per-step model selection
 *
 * @example
 * const executor = createSkillExecutor();
 * const result = await executor.execute(skill, options);
 */
export function createSkillExecutor(): SkillExecutor {
    const toolResolver = createToolResolver();
    const registry = createDefaultRegistry(toolResolver);
    const modelResolver = createModelResolver();

    return new SkillExecutor(registry, modelResolver);
}
