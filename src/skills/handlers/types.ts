/**
 * Step Handler Types
 *
 * Defines the Strategy pattern interfaces for step execution.
 * Each step type has its own dedicated handler.
 *
 * ## Step Types and Handlers
 *
 * Each StepType maps to a dedicated handler:
 *
 * ```
 * StepType            Handler                    Category
 * ─────────────────────────────────────────────────────────
 * 'confirmation'   →  ConfirmationStepHandler    'confirmation'
 * 'tool'           →  ToolStepHandler            'execution'
 * 'llm'            →  LLMStepHandler             'execution'
 * undefined        →  LLMStepHandler             'execution'
 * ```
 *
 * Each handler declares `handledStepTypes` to explicitly specify which
 * `StepType` values it processes, making this mapping discoverable.
 *
 * ## Design Principles
 * - Handlers receive read-only context, return results via HandlerResult
 * - Context updates returned in contextUpdates, applied by executor
 * - Single Responsibility: each handler handles ONE step type
 * - Open/Closed: add new handlers without modifying executor
 *
 * ## Hook Responsibilities (Layer Ownership)
 *
 * Hooks are owned by specific layers to maintain clear separation of concerns:
 *
 * **Executor owns (lifecycle hooks):**
 * - onStepStart, onStepComplete, onStepSkipped
 * - onSkillComplete, onSkillError
 * - onNoHandler, onModelFallback
 *
 * **Handlers own (phase/content hooks):**
 * - onPromptDisplay (show interpolated prompt)
 * - onConfirmationRequired (confirmation handler only)
 *
 * **Runners own (fine-grained progress):**
 * - onPhaseStart, onPhaseComplete
 * - onStreamChunk, onStreamEnd
 *
 * Handlers should NOT call lifecycle hooks - the executor handles those.
 * modelUsed is added by executor for handlers with usesLLM: true.
 */

import type * as vscode from 'vscode';
import type {
    Skill,
    SkillStep,
    StepType,
    ExecutionContext,
    StepResult,
    SkillResult,
    PendingConfirmationInfo,
    VerboseMode,
    ResolvedModel
} from '../types';
import type { ParsedStep } from '../types';
import type { ProgressHooks } from '../progress-hooks';
import type { StepInspectionKind } from '../execution-state';

/**
 * Handler category - how handlers classify themselves
 *
 * This is distinct from `StepType` (the domain type in skill.yaml).
 * Multiple StepTypes can map to a single HandlerCategory.
 *
 * - 'confirmation': Handlers that pause execution for user input
 * - 'execution': Handlers that execute steps (LLM calls, tool invocations)
 *
 * @see StepType for the domain type used in skill definitions
 */
export type HandlerCategory = 'confirmation' | 'execution';

/**
 * Step status for execution state tracking
 *
 * Handlers return status changes via HandlerResult.statusUpdate.
 * The executor applies these to ExecutionStateManager.
 *
 * - active: Step currently executing
 * - awaiting-input: Step paused waiting for user input (confirmation steps)
 * - completed: Step finished successfully
 * - skipped: Step skipped (condition not met)
 * - error: Step failed with error
 */
export type HandlerStepStatus = 'active' | 'awaiting-input' | 'completed' | 'skipped' | 'error';

/**
 * Read-only context provided to step handlers
 *
 * Handlers should not mutate this - they return results instead.
 */
export interface StepContext {
    /** The skill being executed */
    readonly skill: Skill;

    /** Current step definition */
    readonly step: SkillStep;

    /** Index of this step (0-based) */
    readonly stepIndex: number;

    /** Total number of steps in skill */
    readonly totalSteps: number;

    /** Parsed step content (prompt, metadata) */
    readonly parsedStep: ParsedStep | undefined;

    /** Execution context with inputs/outputs */
    readonly context: ExecutionContext;

    /** Cancellation token */
    readonly token: vscode.CancellationToken;

    /** Tool invocation token for MCP calls */
    readonly toolToken: vscode.ChatParticipantToolToken | undefined;

    /** LLM model to use (from request, may differ from resolvedModel) */
    readonly model: vscode.LanguageModelChat;

    /**
     * Resolved model for this step (after alias resolution and fallback)
     *
     * Contains the actual model to use plus metadata:
     * - displayName: for UI badges
     * - source: how it was selected
     * - usedFallback: if original was unavailable
     *
     * Only defined for LLM steps. Non-LLM steps (tool, confirmation)
     * don't use models, so this will be undefined.
     */
    readonly resolvedModel: ResolvedModel | undefined;

    /** Verbose mode setting */
    readonly verboseMode: VerboseMode;

    /** Execution start time (for duration calculation) */
    readonly startTime: number;

    /** Results collected so far */
    readonly stepResults: readonly StepResult[];
}

/**
 * Context updates to be applied by executor
 *
 * Handlers return these instead of mutating context directly.
 */
export interface ContextUpdates {
    /** Output value to store (key is step.output) */
    output?: unknown;

    /** Step timing to record */
    stepTime?: number;
}

/**
 * Result returned by a step handler
 *
 * Handlers return this instead of mutating state directly.
 * The executor applies contextUpdates and builds skillResult when needed.
 */
export interface HandlerResult {
    /**
     * How the main loop should proceed: 'continue' to advance to the next step
     * (whether the step succeeded, failed-and-continued, or was skipped — the
     * 'skipped'/'error' STATUS carries that distinction, not the action), or
     * 'return' to end the skill (abort or pending confirmation).
     */
    action: 'continue' | 'return';

    /** Step result to add to results collection */
    stepResult?: StepResult;

    /** Context updates to apply (executor handles mutation) */
    contextUpdates?: ContextUpdates;

    /**
     * For special cases only - the final skill result
     *
     * Most handlers should NOT set this. Used only for:
     * - Confirmation steps (returns with pendingConfirmation)
     *
     * For error abort cases, executor builds skillResult from stepResult.
     */
    skillResult?: SkillResult;

    /** For confirmation steps - pending info for resume */
    pendingConfirmation?: PendingConfirmationInfo;

    /** Whether executor should report completion to stream (default: true) */
    reportCompletion?: boolean;

    /**
     * Status update for execution state tracking
     *
     * Handlers return status changes instead of calling executionState directly.
     * The executor applies these changes to maintain single point of state mutation.
     */
    statusUpdate?: HandlerStepStatus;
}

/**
 * Step handler interface (Strategy pattern)
 *
 * Each handler implements this interface to process one category of steps.
 * Handlers are stateless - all state is in StepContext.
 *
 * @example
 * ```typescript
 * class MyCustomHandler implements StepHandler {
 *     readonly category: HandlerCategory = 'execution';
 *     readonly handledStepTypes: readonly StepType[] = ['llm'];
 *
 *     canHandle(step: SkillStep): boolean {
 *         return step.type === 'llm' && step.someCustomProperty;
 *     }
 *
 *     async handle(ctx: StepContext, hooks: ProgressHooks): Promise<HandlerResult> {
 *         // ... implementation
 *     }
 * }
 * ```
 */
export interface StepHandler {
    /**
     * Handler category - how this handler classifies itself
     *
     * Used for handler lookup and debugging. Multiple handlers can
     * share the same category (e.g., multiple 'execution' handlers).
     */
    readonly category: HandlerCategory;

    /**
     * Step types this handler can process
     *
     * Explicitly declares which `StepType` values from skill.yaml
     * this handler is designed to handle. This makes the StepType
     * to HandlerCategory mapping discoverable.
     *
     * @example ['confirmation'] for ConfirmationStepHandler
     * @example ['llm', 'tool'] for ExecutionStepHandler
     */
    readonly handledStepTypes: readonly StepType[];

    /**
     * Whether this handler requires an LLM for execution
     *
     * When true, the executor will:
     * 1. Resolve the LLM (applying aliases, fallbacks, user overrides)
     * 2. Pass resolvedModel in StepContext
     * 3. Update execution state with model info (for graph badge display)
     * 4. Include model info in progress hooks
     *
     * LLM handlers set this to true; tool and confirmation handlers set false.
     * This allows the executor to remain step-type-agnostic while handlers
     * declare their own requirements.
     */
    readonly usesLLM: boolean;

    /**
     * Inspection kind to capture for this handler's steps, or undefined when the
     * step type has no inspectable prompt/response (e.g. tool, context).
     *
     * The executor records step I/O for the graph inspector based on this, so the
     * handler is the single authority on whether its steps are inspectable
     * (mirrors the `usesLLM` pattern — no parallel step-type table to keep in sync).
     */
    readonly inspectionKind?: StepInspectionKind;

    /**
     * Check if this handler can process the given step
     *
     * This is the authoritative routing check. The registry calls this
     * method to determine which handler should process a step.
     *
     * @param step - The step to check
     * @returns true if this handler should process the step
     */
    canHandle(step: SkillStep): boolean;

    /**
     * Execute the step
     *
     * @param ctx - Read-only execution context
     * @param hooks - Progress reporting hooks
     * @returns Handler result indicating outcome and any results
     */
    handle(ctx: StepContext, hooks: ProgressHooks): Promise<HandlerResult>;
}

/**
 * Factory for creating step context
 *
 * Used by executor to create context for handlers.
 */
export interface StepContextFactory {
    create(
        skill: Skill,
        step: SkillStep,
        stepIndex: number,
        parsedStep: ParsedStep | undefined,
        context: ExecutionContext,
        options: {
            token: vscode.CancellationToken;
            toolToken: vscode.ChatParticipantToolToken | undefined;
            model: vscode.LanguageModelChat;
            resolvedModel: ResolvedModel | undefined;
            verboseMode: VerboseMode;
        },
        startTime: number,
        stepResults: StepResult[]
    ): StepContext;
}
