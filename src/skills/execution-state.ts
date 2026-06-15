/**
 * Execution State Management
 *
 * Single source of truth for skill execution state.
 * Provides pub/sub pattern for state changes - anyone can subscribe.
 *
 * ## Dependency Injection
 *
 * The ExecutionStateManager interface enables DI for testability.
 * Create instances via `createExecutionState()` factory.
 *
 * Use cases:
 * - Graph panel highlighting (current)
 * - Model badge updates during execution
 * - Telemetry/logging (future)
 * - State persistence/replay (future)
 */

import { EventEmitter } from 'events';
import type { StepModelInfo } from './types';

// ============================================================================
// Types (Single Source of Truth for Execution State)
// ============================================================================

/**
 * Step execution status
 *
 * - pending: Step not yet started
 * - active: Step currently executing
 * - awaiting-input: Step paused waiting for user input (e.g., confirmation)
 * - completed: Step finished successfully
 * - skipped: Step skipped due to condition
 * - error: Step failed with error
 */
export type StepStatus = 'pending' | 'active' | 'awaiting-input' | 'completed' | 'skipped' | 'error';

/**
 * Terminal node (start/end) status
 */
export type TerminalStatus = 'idle' | 'active' | 'completed';

/**
 * Model override information when user selects specific model (non-Auto)
 */
export interface ModelOverride {
    /** Display name of the model (e.g., "Claude Sonnet 4") */
    displayName: string;
    /** The model ID */
    modelId: string;
}

/**
 * Current execution state for a skill
 */
export interface ExecutionState {
    /** Skill being executed */
    skillId: string;
    /** Status of each step by ID */
    steps: Map<string, StepStatus>;
    /** Terminal node states */
    terminals: { start: TerminalStatus; end: TerminalStatus };
    /** Currently active step ID (null if none) */
    currentStepId: string | null;
    /** Execution start timestamp */
    startedAt: number;
    /**
     * Monotonic generation token, unique per startExecution/reset. Used to
     * discard delayed work (e.g. the completion animation timer) that was
     * scheduled against a since-reset or since-restarted run.
     */
    generation: number;
    /** Model override when user selects specific model (non-Auto mode) */
    modelOverride?: ModelOverride;
    /** Model info per step (populated as steps execute) */
    stepModels: Map<string, StepModelInfo>;
}

/**
 * Events emitted by ExecutionStateEmitter
 */
export type ExecutionEvent =
    | { type: 'execution:start'; skillId: string; modelOverride?: ModelOverride }
    | { type: 'execution:reset'; skillId: string }
    | { type: 'execution:complete'; skillId: string; success: boolean }
    | { type: 'step:status'; skillId: string; stepId: string; status: StepStatus; previous?: StepStatus; model?: StepModelInfo }
    | { type: 'terminal:status'; skillId: string; terminal: 'start' | 'end'; status: TerminalStatus };

/**
 * Listener function type for execution events
 */
export type ExecutionEventListener = (event: ExecutionEvent) => void;

// ============================================================================
// ExecutionStateManager Interface
// ============================================================================

/**
 * Options for starting execution
 */
export interface StartExecutionOptions {
    /** Model override when user selects specific model (non-Auto mode) */
    modelOverride?: ModelOverride;
}

/**
 * Options for setting step status
 */
export interface SetStepStatusOptions {
    /** Model info for this step (for runtime badge updates) */
    model?: StepModelInfo;
}

/**
 * Interface for execution state management.
 *
 * Enables dependency injection for testability.
 * Implement this interface or use ExecutionStateEmitter.
 */
export interface ExecutionStateManager {
    /** Start tracking a new execution */
    startExecution(skillId: string, stepIds: string[], options?: StartExecutionOptions): void;

    /** Update step status */
    setStepStatus(skillId: string, stepId: string, status: StepStatus, options?: SetStepStatusOptions): void;

    /** Update terminal node status */
    setTerminalStatus(skillId: string, terminal: 'start' | 'end', status: TerminalStatus): void;

    /** Reset all state for a skill */
    reset(skillId: string): void;

    /** Reset all tracked execution states (e.g., on chat /clear) */
    resetAll(): void;

    /**
     * Finish execution with success animation
     *
     * On success: animates terminal 'end' through active → completed (1200ms delay).
     * Uses stale execution guard to prevent race conditions.
     * Emits execution:complete event.
     *
     * @param skillId - Skill ID
     * @param success - Whether execution succeeded
     */
    finishExecution(skillId: string, success: boolean): void;

    /** Query current state for a skill */
    getState(skillId: string): ExecutionState | undefined;

    /** Check if a skill is being tracked */
    hasState(skillId: string): boolean;

    /** Subscribe to execution events */
    subscribe(listener: ExecutionEventListener): () => void;
}

// ============================================================================
// ExecutionStateEmitter Class
// ============================================================================

/**
 * Centralized execution state manager with pub/sub support.
 *
 * This is the single point where execution state changes.
 * Components subscribe to receive state change events.
 *
 * @example
 * // In SkillExecutor - emit state changes
 * executionState.setStepStatus(skillId, stepId, 'active');
 *
 * // In PanelManager - subscribe to events
 * executionState.subscribe((event) => {
 *     if (event.type === 'step:status') {
 *         this.highlightStep(event.skillId, event.stepId, event.status);
 *     }
 * });
 */
export class ExecutionStateEmitter extends EventEmitter implements ExecutionStateManager {
    private states = new Map<string, ExecutionState>();
    /** Source of globally-unique generation tokens (see ExecutionState.generation). */
    private generationCounter = 0;

    /**
     * Start tracking a new execution
     *
     * @param skillId - Skill ID
     * @param stepIds - All step IDs in execution order
     * @param options - Optional execution options (model override, etc.)
     */
    startExecution(skillId: string, stepIds: string[], options?: StartExecutionOptions): void {
        const state: ExecutionState = {
            skillId,
            steps: new Map(stepIds.map(id => [id, 'pending' as StepStatus])),
            terminals: { start: 'idle', end: 'idle' },
            currentStepId: null,
            startedAt: Date.now(),
            generation: ++this.generationCounter,
            modelOverride: options?.modelOverride,
            stepModels: new Map()
        };
        this.states.set(skillId, state);
        this.emitEvent({ type: 'execution:start', skillId, modelOverride: options?.modelOverride });
    }

    /**
     * Update step status
     *
     * When a step becomes active, automatically completes the previous active step.
     *
     * @param skillId - Skill ID
     * @param stepId - Step ID to update
     * @param status - New status
     * @param options - Optional status options (model info, etc.)
     */
    setStepStatus(skillId: string, stepId: string, status: StepStatus, options?: SetStepStatusOptions): void {
        const state = this.states.get(skillId);
        if (!state) return;

        const previous = state.steps.get(stepId);

        // Store model info if provided
        if (options?.model) {
            state.stepModels.set(stepId, options.model);
        }

        // Auto-complete previous active step when new step becomes active
        if (status === 'active' && state.currentStepId && state.currentStepId !== stepId) {
            const prevStatus = state.steps.get(state.currentStepId);
            if (prevStatus === 'active') {
                state.steps.set(state.currentStepId, 'completed');
                // Include model info from previous step if available
                const prevModel = state.stepModels.get(state.currentStepId);
                this.emitEvent({
                    type: 'step:status',
                    skillId,
                    stepId: state.currentStepId,
                    status: 'completed',
                    previous: 'active',
                    model: prevModel
                });
            }
        }

        state.steps.set(stepId, status);

        if (status === 'active') {
            state.currentStepId = stepId;
        } else if (stepId === state.currentStepId) {
            state.currentStepId = null;
        }

        this.emitEvent({ type: 'step:status', skillId, stepId, status, previous, model: options?.model });
    }

    /**
     * Update terminal node status
     *
     * @param skillId - Skill ID
     * @param terminal - Which terminal ('start' or 'end')
     * @param status - New status
     */
    setTerminalStatus(skillId: string, terminal: 'start' | 'end', status: TerminalStatus): void {
        const state = this.states.get(skillId);
        if (!state) return;

        state.terminals[terminal] = status;
        this.emitEvent({ type: 'terminal:status', skillId, terminal, status });
    }

    /**
     * Reset all state for a skill (before new execution)
     *
     * @param skillId - Skill ID to reset
     */
    reset(skillId: string): void {
        const state = this.states.get(skillId);
        if (state) {
            state.steps.forEach((_, key) => state.steps.set(key, 'pending'));
            state.terminals = { start: 'idle', end: 'idle' };
            state.currentStepId = null;
            // New generation: invalidates any delayed work from the prior run.
            state.generation = ++this.generationCounter;
            state.modelOverride = undefined;
            state.stepModels.clear();
        }
        this.emitEvent({ type: 'execution:reset', skillId });
    }

    /**
     * Reset all tracked execution states
     *
     * Called when chat is cleared (/clear) or a new session starts.
     * Emits reset events for each tracked skill so graph panels update.
     */
    resetAll(): void {
        for (const skillId of this.states.keys()) {
            this.reset(skillId);
        }
    }

    /**
     * Finish execution with success animation
     *
     * On success: animates terminal 'end' through active → completed (1200ms delay).
     * Uses stale execution guard to prevent race conditions.
     * Emits execution:complete event.
     *
     * @param skillId - Skill ID
     * @param success - Whether execution succeeded
     */
    finishExecution(skillId: string, success: boolean): void {
        if (success) {
            this.setTerminalStatus(skillId, 'end', 'active');
            const generation = this.getState(skillId)?.generation;
            setTimeout(() => {
                // Discard if the run was reset or restarted in the meantime.
                const current = this.getState(skillId);
                if (generation === undefined || current?.generation !== generation) return;
                this.setTerminalStatus(skillId, 'end', 'completed');
            }, 1200);
        }
        this.emitEvent({ type: 'execution:complete', skillId, success });
    }

    /**
     * Query current state for a skill
     *
     * @param skillId - Skill ID
     * @returns Current execution state or undefined if not tracking
     */
    getState(skillId: string): ExecutionState | undefined {
        return this.states.get(skillId);
    }

    /**
     * Check if a skill is being tracked
     *
     * @param skillId - Skill ID
     * @returns true if execution state exists
     */
    hasState(skillId: string): boolean {
        return this.states.has(skillId);
    }

    /**
     * Subscribe to execution events
     *
     * @param listener - Function called for each event
     * @returns Unsubscribe function
     */
    subscribe(listener: ExecutionEventListener): () => void {
        this.on('event', listener);
        return () => this.off('event', listener);
    }

    /**
     * Emit an event to all subscribers
     */
    private emitEvent(event: ExecutionEvent): void {
        this.emit('event', event);
    }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new ExecutionStateManager instance.
 *
 * Use this factory for dependency injection:
 * - Create once at extension activation
 * - Pass to CommandContext, SkillExecutor, PanelManager
 * - In tests, create fresh instances
 */
export function createExecutionState(): ExecutionStateManager {
    return new ExecutionStateEmitter();
}
