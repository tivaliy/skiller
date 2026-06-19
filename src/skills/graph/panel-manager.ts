/**
 * Skill Graph Panel Manager
 *
 * Manages WebviewPanel lifecycle for skill graphs.
 * Enables panel reuse, live reload, and proper cleanup.
 *
 * Subscribes to ExecutionStateEmitter to automatically update
 * graph highlighting during skill execution.
 */

import * as vscode from 'vscode';
import type { Skill, ModelSource } from '../types';
import type { ExtensionMessage, RenderOptions, SkillGraph, WebviewMessage } from './types';
import { getGraphRenderer } from './renderer';
import type { ExecutionStateManager, StepStatus, TerminalStatus, StepInspection } from '../execution-state';

/**
 * Callback for handling webview messages
 */
export type MessageHandler = (message: WebviewMessage) => void;

/**
 * Managed panel entry with metadata
 */
interface ManagedPanel {
    /** The webview panel */
    panel: vscode.WebviewPanel;
    /** Skill ID this panel displays */
    skillId: string;
    /** Skill source path for file watching */
    skillPath: string;
    /** Message handler subscription */
    messageDisposable: vscode.Disposable;
}

/**
 * Manages skill graph webview panels
 *
 * Features:
 * - Panel reuse: reopening same skill reuses existing panel
 * - Live reload: update() pushes new content without recreating
 * - Cleanup: proper disposal when panels close
 * - Execution state resync: restores highlights after tab switch
 */
export class SkillGraphPanelManager {
    /** Active panels indexed by skill ID */
    private panels = new Map<string, ManagedPanel>();

    /** Execution state manager reference for resync (set via connectExecutionState) */
    private executionState?: ExecutionStateManager;

    /** Unsubscribe for the current execution-state subscription (idempotency guard) */
    private executionUnsubscribe?: () => void;

    /**
     * Register a new panel for a skill
     *
     * @param skillId - Unique skill identifier
     * @param skill - The skill definition
     * @param panel - The webview panel
     * @param onMessage - Handler for messages from webview
     */
    register(
        skillId: string,
        skill: Skill,
        panel: vscode.WebviewPanel,
        onMessage: MessageHandler
    ): void {
        // If panel already exists for this skill, dispose old one
        const existing = this.panels.get(skillId);
        if (existing) {
            existing.messageDisposable.dispose();
            // Don't dispose panel - it may be the same one being reused
        }

        // Wrap message handler to intercept 'ready' for execution state resync
        const wrappedHandler: MessageHandler = (message) => {
            // Resync execution state when webview becomes ready after tab switch
            if (message.type === 'ready') {
                this.resyncExecutionState(skillId);
            }
            // Always forward to original handler
            onMessage(message);
        };

        // Subscribe to messages
        const messageDisposable = panel.webview.onDidReceiveMessage(wrappedHandler);

        // Handle panel disposal
        panel.onDidDispose(() => {
            const entry = this.panels.get(skillId);
            if (entry?.panel === panel) {
                entry.messageDisposable.dispose();
                this.panels.delete(skillId);
            }
        });

        // Store reference
        this.panels.set(skillId, {
            panel,
            skillId,
            skillPath: skill.source.path,
            messageDisposable
        });
    }

    /**
     * Get existing panel for a skill (if any)
     */
    getPanel(skillId: string): vscode.WebviewPanel | undefined {
        return this.panels.get(skillId)?.panel;
    }

    /**
     * Update panel content (for live reload).
     *
     * Note: This only updates the graph content. Call clearMessages() separately
     * before showing new validation results to prevent stale messages.
     *
     * @param skillId - Skill to update
     * @param graph - The rebuilt graph to render
     * @param renderOptions - Optional render options (direction, showTools, ...)
     * @returns true if panel was updated, false if no panel exists
     */
    update(skillId: string, graph: SkillGraph, renderOptions?: RenderOptions): boolean {
        const entry = this.panels.get(skillId);
        if (!entry) {
            return false;
        }

        const message = getGraphRenderer().buildUpdateMessage(graph, renderOptions);
        void entry.panel.webview.postMessage(message);
        return true;
    }

    /**
     * Show error in panel (for live reload)
     *
     * @param skillId - Skill to show error for
     * @param title - Error title (e.g., "YAML Parse Error", "Validation Error")
     * @param message - Error message to display
     * @returns true if error was shown, false if no panel exists
     */
    showError(skillId: string, title: string, message: string): boolean {
        const entry = this.panels.get(skillId);
        if (!entry) {
            return false;
        }

        const errorMessage: ExtensionMessage = { type: 'error', title, message };
        void entry.panel.webview.postMessage(errorMessage);
        return true;
    }

    /**
     * Show warning in panel (for validation warnings)
     *
     * Warnings don't block validation but alert users to potential issues.
     * The warning panel is collapsible - users can collapse it to focus on the graph.
     *
     * @param skillId - Skill to show warning for
     * @param title - Warning title (e.g., "Validation Warning")
     * @param message - Warning message to display
     * @param count - Number of warnings (for badge display)
     * @returns true if warning was shown, false if no panel exists
     */
    showWarning(skillId: string, title: string, message: string, count: number): boolean {
        const entry = this.panels.get(skillId);
        if (!entry) {
            return false;
        }

        const warningMessage: ExtensionMessage = { type: 'warning', title, message, count };
        void entry.panel.webview.postMessage(warningMessage);
        return true;
    }

    /**
     * Clear all validation messages (errors and warnings) from panel
     *
     * Use this before showing new validation results to prevent stale messages.
     *
     * @param skillId - Skill to clear messages for
     * @returns true if messages were cleared, false if no panel exists
     */
    clearMessages(skillId: string): boolean {
        const entry = this.panels.get(skillId);
        if (!entry) {
            return false;
        }

        void entry.panel.webview.postMessage({ type: 'clearError' } as ExtensionMessage);
        return true;
    }

    /**
     * Reveal an existing panel (bring to front)
     *
     * @param skillId - Skill panel to reveal
     * @returns true if panel was revealed, false if no panel exists
     */
    revealPanel(skillId: string): boolean {
        const entry = this.panels.get(skillId);
        if (!entry) {
            return false;
        }

        entry.panel.reveal();
        return true;
    }

    /**
     * Close panel for a skill
     */
    closePanel(skillId: string): void {
        const entry = this.panels.get(skillId);
        if (entry) {
            entry.messageDisposable.dispose();
            entry.panel.dispose();
            this.panels.delete(skillId);
        }
    }

    /**
     * Close all panels (for extension deactivation)
     */
    disposeAll(): void {
        for (const [skillId] of this.panels) {
            this.closePanel(skillId);
        }
    }

    /**
     * Get all skill IDs with open panels
     */
    getOpenSkillIds(): string[] {
        return Array.from(this.panels.keys());
    }

    /**
     * Get skill path for a panel (for file watching)
     */
    getSkillPath(skillId: string): string | undefined {
        return this.panels.get(skillId)?.skillPath;
    }

    /**
     * Highlight a step in the graph (for execution progress)
     *
     * @param skillId - Skill to highlight step in
     * @param stepId - Step to highlight
     * @param status - Step status (active, completed, error, skipped)
     * @returns true if message was sent, false if no panel exists
     */
    highlightStep(skillId: string, stepId: string, status: StepStatus): boolean {
        const entry = this.panels.get(skillId);
        if (!entry) {
            return false;
        }

        const message: ExtensionMessage = { type: 'highlightStep', stepId, status };
        void entry.panel.webview.postMessage(message);
        return true;
    }

    /**
     * Reset all step highlights (before new execution)
     *
     * @param skillId - Skill to reset highlights for
     * @returns true if message was sent, false if no panel exists
     */
    resetHighlights(skillId: string): boolean {
        const entry = this.panels.get(skillId);
        if (!entry) {
            return false;
        }

        const message: ExtensionMessage = { type: 'resetHighlights' };
        void entry.panel.webview.postMessage(message);
        return true;
    }

    /**
     * Highlight a terminal node (start or end)
     *
     * @param skillId - Skill to highlight terminal in
     * @param terminal - Which terminal ('start' or 'end')
     * @param status - Terminal status (active, completed, idle)
     * @returns true if message was sent, false if no panel exists
     */
    highlightTerminal(skillId: string, terminal: 'start' | 'end', status: TerminalStatus): boolean {
        const entry = this.panels.get(skillId);
        if (!entry) {
            return false;
        }

        const message: ExtensionMessage = { type: 'highlightTerminal', terminal, status };
        void entry.panel.webview.postMessage(message);
        return true;
    }

    /**
     * Set or clear model override banner
     *
     * @param skillId - Skill to update
     * @param model - Model display name, or null to clear
     * @returns true if message was sent, false if no panel exists
     */
    setModelOverride(skillId: string, model: string | null): boolean {
        const entry = this.panels.get(skillId);
        if (!entry) {
            return false;
        }

        const message: ExtensionMessage = { type: 'setModelOverride', model };
        void entry.panel.webview.postMessage(message);
        return true;
    }

    /**
     * Update a step's model badge with runtime information
     *
     * @param skillId - Skill to update
     * @param stepId - Step to update
     * @param model - Model display name
     * @param source - How the model was selected (runtime resolution)
     * @returns true if message was sent, false if no panel exists
     */
    updateStepModel(skillId: string, stepId: string, model: string, source: ModelSource): boolean {
        const entry = this.panels.get(skillId);
        if (!entry) {
            return false;
        }

        const message: ExtensionMessage = { type: 'updateStepModel', stepId, model, source };
        void entry.panel.webview.postMessage(message);
        return true;
    }

    /**
     * Serve captured step inspection data to the webview in response to a hover request.
     *
     * Posts a `stepInspection` message with the captured data, or null if nothing was
     * captured (an un-run, skipped, or non-prompt step). Lazy-pull keeps large
     * prompt/response payloads out of the webview until a node is actually hovered.
     *
     * @returns true if a message was sent, false if no panel exists
     */
    handleRequestStepInspection(skillId: string, stepId: string): boolean {
        const entry = this.panels.get(skillId);
        if (!entry) {
            return false;
        }

        const data = this.getStepInspection(skillId, stepId) ?? null;
        const message: ExtensionMessage = { type: 'stepInspection', stepId, data };
        void entry.panel.webview.postMessage(message);
        return true;
    }

    /**
     * Read the captured inspection data for a step (used by the copy-to-clipboard path).
     *
     * @returns the captured data, or undefined if no state exists or nothing was captured
     */
    getStepInspection(skillId: string, stepId: string): StepInspection | undefined {
        return this.executionState?.getState(skillId)?.stepInspections.get(stepId);
    }

    /**
     * Resync execution state to webview after tab switch
     *
     * Called when webview sends 'ready' message after being recreated.
     * Restores all step highlights, terminal states, and model override banner.
     *
     * @param skillId - Skill to resync state for
     * @returns true if state was resynced, false if no state or panel exists
     */
    resyncExecutionState(skillId: string): boolean {
        if (!this.executionState) return false;

        const state = this.executionState.getState(skillId);
        if (!state) return false;

        const entry = this.panels.get(skillId);
        if (!entry) return false;

        // Resync model override banner
        if (state.modelOverride) {
            this.setModelOverride(skillId, state.modelOverride.displayName);
        }

        // Resync terminal states
        if (state.terminals.start !== 'idle') {
            this.highlightTerminal(skillId, 'start', state.terminals.start);
        }
        if (state.terminals.end !== 'idle') {
            this.highlightTerminal(skillId, 'end', state.terminals.end);
        }

        // Resync all step statuses (including model badges)
        for (const [stepId, status] of state.steps) {
            // Only send non-pending statuses (pending is the default)
            if (status !== 'pending') {
                this.highlightStep(skillId, stepId, status);

                // Also resync model badge if available
                const modelInfo = state.stepModels.get(stepId);
                if (modelInfo) {
                    this.updateStepModel(skillId, stepId, modelInfo.displayName, modelInfo.source);
                }
            }
        }

        return true;
    }

    /**
     * Connect to execution state for graph highlighting and model updates
     *
     * Call this once after creating the panel manager to enable
     * automatic graph highlighting and model badge updates during skill execution.
     * Also enables execution state resync when webview becomes ready after tab switch.
     *
     * @param executionState - The execution state manager to subscribe to
     * @returns Unsubscribe function for cleanup
     */
    connectExecutionState(executionState: ExecutionStateManager): () => void {
        // Idempotent: drop any prior subscription so a re-connect (e.g. re-activation
        // or tests) doesn't leak a duplicate listener.
        this.executionUnsubscribe?.();

        // Store reference for resync on tab switch
        this.executionState = executionState;

        const unsubscribe = executionState.subscribe((event) => {
            switch (event.type) {
                case 'execution:start':
                    this.resetHighlights(event.skillId);
                    // Show model override banner if user selected specific model
                    if (event.modelOverride) {
                        this.setModelOverride(event.skillId, event.modelOverride.displayName);
                    } else {
                        this.setModelOverride(event.skillId, null);
                    }
                    break;
                case 'step:status':
                    this.highlightStep(event.skillId, event.stepId, event.status);
                    // Update step's model badge if model info is available
                    if (event.model) {
                        this.updateStepModel(event.skillId, event.stepId, event.model.displayName, event.model.source);
                    }
                    break;
                case 'terminal:status':
                    this.highlightTerminal(event.skillId, event.terminal, event.status);
                    break;
                case 'execution:reset':
                    this.resetHighlights(event.skillId);
                    this.setModelOverride(event.skillId, null);
                    break;
                case 'step:inspection':
                    // Deliberate no-op: hover inspection data is served lazily on demand
                    // (requestStepInspection → stepInspection), not pushed. The doc provider
                    // refreshes open inspector tabs via its own subscription.
                    break;
            }
        });

        this.executionUnsubscribe = () => {
            unsubscribe();
            this.executionUnsubscribe = undefined;
        };
        return this.executionUnsubscribe;
    }
}

/**
 * Global panel manager instance
 *
 * Call panelManager.connectExecutionState(executionState) during
 * extension activation to enable graph highlighting.
 */
export const panelManager = new SkillGraphPanelManager();
