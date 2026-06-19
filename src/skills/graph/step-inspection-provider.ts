/**
 * Step Debug Document Provider
 *
 * Read-only virtual document provider for the step inspector. Renders the
 * captured prompt/response for an executed step (from execution state) as a
 * Markdown document under the `skiller-inspect` scheme.
 *
 * Why a content provider (vs an untitled doc):
 * - Read-only by construction — the scheme is never writable, so there's no
 *   accidental edit and no "save?" prompt on close.
 * - No temp file to write or clean up.
 * - Stable URI per (skill, step), so reopening reuses the tab.
 * - Refreshes in place when the step re-runs (onDidChange), so a loop's latest
 *   iteration is always shown.
 * - `.md` suffix gives native Markdown preview for free.
 */

import * as vscode from 'vscode';
import type { ExecutionStateManager } from '../execution-state';
import { buildStepInspectionUri, parseStepInspectionUri, renderStepInspectionMarkdown } from '../step-inspection';

export class StepInspectionDocumentProvider implements vscode.TextDocumentContentProvider {
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    /** Fires when an open inspector document's content should be re-fetched. */
    readonly onDidChange = this._onDidChange.event;
    private readonly unsubscribe: () => void;

    constructor(private readonly executionState: ExecutionStateManager) {
        // Refresh an open inspector tab when its step re-runs (a new capture).
        this.unsubscribe = executionState.subscribe(event => {
            if (event.type === 'step:inspection') {
                this._onDidChange.fire(buildStepInspectionUri(event.skillId, event.stepId));
            }
        });
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        const parsed = parseStepInspectionUri(uri);
        if (!parsed) {
            return '# Step inspector\n\nInvalid inspector URI.\n';
        }

        const data = this.executionState.getState(parsed.skillId)?.stepInspections.get(parsed.stepId);
        if (!data) {
            return (
                `# Step: ${parsed.stepId}\n\n` +
                'No captured data for this step. Run the skill, then open the inspector ' +
                'from an executed node in the graph.\n'
            );
        }

        return renderStepInspectionMarkdown(parsed.stepId, data);
    }

    dispose(): void {
        this.unsubscribe();
        this._onDidChange.dispose();
    }
}
