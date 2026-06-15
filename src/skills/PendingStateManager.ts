/**
 * Pending State Manager
 *
 * Manages skill execution state for confirmations and input collection.
 * Replaces module-singleton pattern with an injectable class for better testability.
 *
 * Session-scoped state for tracking:
 * - Skills waiting for user confirmation
 * - Skills waiting for input collection
 *
 * State is stored per instance since:
 * - Each VS Code window runs in a separate extension host process (memory isolation)
 * - Within a single chat, skill switching is blocked while state is pending
 * - State is intentionally lost when VS Code restarts (acceptable for MVP)
 */

import {
    Skill,
    SkillInput,
    ExecutionContext,
    ConfirmationOption,
    StepResult,
    PendingConfirmation,
    PendingInputCollection,
    ExecutionOptions,
    ResumeOptions
} from './types';

/**
 * Extended pending confirmation with execution options
 */
interface PendingConfirmationWithOptions extends PendingConfirmation {
    executionOptions: Omit<ExecutionOptions, 'inputs'>;
}

/**
 * Manages pending state for skill confirmations and input collection.
 */
export class PendingStateManager {
    private pendingConfirmation: PendingConfirmationWithOptions | null = null;
    private pendingInputCollection: PendingInputCollection | null = null;

    // ============ Confirmation State ============

    /**
     * Set the pending confirmation state
     */
    setPendingConfirmation(
        skill: Skill,
        context: ExecutionContext,
        stepIndex: number,
        options: ConfirmationOption[],
        stepResults: StepResult[],
        executionOptions: Omit<ExecutionOptions, 'inputs'>
    ): void {
        this.pendingConfirmation = {
            skillId: skill.id,
            skill,
            context,
            pendingStepIndex: stepIndex,
            options,
            stepResults,
            executionOptions
        };
    }

    /**
     * Get the current pending confirmation state
     */
    getPendingConfirmation(): PendingConfirmation | null {
        return this.pendingConfirmation;
    }

    /**
     * Get the stored execution options for resuming
     */
    getPendingExecutionOptions(): Omit<ExecutionOptions, 'inputs'> | null {
        return this.pendingConfirmation?.executionOptions ?? null;
    }

    /**
     * Clear the pending confirmation state
     */
    clearPendingConfirmation(): void {
        this.pendingConfirmation = null;
    }

    /**
     * Check if there is a pending confirmation
     */
    hasPendingConfirmation(): boolean {
        return this.pendingConfirmation !== null;
    }

    /**
     * Create resume options from pending state
     * Call this after user confirms to get the options for resuming execution
     * @param startFromStep The step index to resume from (usually pendingStepIndex + 1)
     */
    createResumeOptions(startFromStep: number): ResumeOptions | null {
        if (!this.pendingConfirmation) {
            return null;
        }

        return {
            startFromStep,
            existingContext: this.pendingConfirmation.context,
            existingStepResults: this.pendingConfirmation.stepResults
        };
    }

    // ============ Input Collection State ============

    /**
     * Set the pending input collection state
     */
    setPendingInputCollection(
        skill: Skill,
        collectedInputs: Record<string, unknown>,
        currentInput: SkillInput,
        remainingInputs: SkillInput[]
    ): void {
        this.pendingInputCollection = {
            skillId: skill.id,
            skill,
            collectedInputs,
            currentInput,
            remainingInputs
        };
    }

    /**
     * Get the current pending input collection state
     */
    getPendingInputCollection(): PendingInputCollection | null {
        return this.pendingInputCollection;
    }

    /**
     * Clear the pending input collection state
     */
    clearPendingInputCollection(): void {
        this.pendingInputCollection = null;
    }

    /**
     * Check if there is a pending input collection
     */
    hasPendingInputCollection(): boolean {
        return this.pendingInputCollection !== null;
    }

    /**
     * Add a collected input value and advance to next input
     * Returns the next input to prompt for, or null if all inputs collected
     */
    addCollectedInput(name: string, value: unknown): SkillInput | null {
        if (!this.pendingInputCollection) return null;

        // Add the collected value
        this.pendingInputCollection.collectedInputs[name] = value;

        // Check if there are more inputs to collect
        if (this.pendingInputCollection.remainingInputs.length > 0) {
            const nextInput = this.pendingInputCollection.remainingInputs[0];
            this.pendingInputCollection.currentInput = nextInput;
            this.pendingInputCollection.remainingInputs =
                this.pendingInputCollection.remainingInputs.slice(1);
            return nextInput;
        }

        return null;
    }

    /**
     * Get all collected inputs (for executing the skill)
     */
    getCollectedInputs(): Record<string, unknown> {
        return this.pendingInputCollection?.collectedInputs ?? {};
    }

    // ============ Combined Operations ============

    /**
     * Clear all pending state (confirmation and input collection)
     * Called when chat history is cleared to remove orphaned state.
     * @returns true if any state was cleared
     */
    clearAllPendingState(): boolean {
        const hadPending =
            this.pendingConfirmation !== null ||
            this.pendingInputCollection !== null;

        if (hadPending) {
            this.pendingConfirmation = null;
            this.pendingInputCollection = null;
        }

        return hadPending;
    }
}
