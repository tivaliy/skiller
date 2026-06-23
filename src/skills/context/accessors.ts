/**
 * Live VS Code Context Accessors
 *
 * The only file in the context module that touches the VS Code / git runtime.
 * Everything else operates on the captured snapshot, so it stays unit-testable.
 */

import * as vscode from 'vscode';
import type { ContextAccessors } from './types';
import { formatDiagnostics } from './sources';

/** Minimal shape of the built-in git extension API we rely on. */
interface GitRepository { diff(cached?: boolean): Promise<string>; }
interface GitAPI { repositories: GitRepository[]; getRepository(uri: vscode.Uri): GitRepository | null; }

function getGitApi(): GitAPI | undefined {
    const ext = vscode.extensions.getExtension<{ getAPI(version: 1): GitAPI }>('vscode.git');
    try {
        return ext?.isActive ? ext.exports.getAPI(1) : undefined;
    } catch {
        return undefined;
    }
}

function pickRepository(api: GitAPI): GitRepository | undefined {
    const active = vscode.window.activeTextEditor?.document.uri;
    // With an active file, use ITS repository or none — never substitute an
    // unrelated repo (that would hand a skill the wrong project's diff). Only
    // fall back to the first repo when there is no active file at all.
    if (active) return api.getRepository(active) ?? undefined;
    return api.repositories[0] ?? undefined;
}

export function createVsCodeContextAccessors(): ContextAccessors {
    return {
        getActiveFile() {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return undefined;
            const doc = editor.document;
            return {
                path: doc.uri.fsPath,
                content: doc.getText(),
                languageId: doc.languageId,
                selection: editor.selection.isEmpty ? undefined : doc.getText(editor.selection),
            };
        },
        async getGitDiff(staged: boolean) {
            const api = getGitApi();
            if (!api) return undefined;
            const repo = pickRepository(api);
            if (!repo) return undefined;
            try {
                const diff = await repo.diff(staged);
                return diff || undefined;
            } catch {
                return undefined;
            }
        },
        getDiagnostics() {
            const uri = vscode.window.activeTextEditor?.document.uri;
            if (!uri) return undefined;
            const diags = vscode.languages.getDiagnostics(uri);
            if (diags.length === 0) return undefined;
            return formatDiagnostics(diags);
        },
    };
}
