/**
 * Skill code actions
 *
 * Offers "Skiller: Run <skill>" actions for skills whose `from:`-bound inputs
 * resolve in the current editor context (selection / active file / diagnostics).
 * Selecting one invokes `skiller.runSkill` with the skill id, which captures a
 * fresh snapshot at launch. Git/clipboard-bound skills are reachable via the
 * Command Palette / context menu instead (full capture there).
 */

import * as vscode from 'vscode';
import type { SkillRegistry, EditorContextSnapshot } from '../skills';
import { formatDiagnostics } from '../skills';
import { skillMatchesContext, anySkillBindsContext, anySkillBindsFileContent } from './matching';

/**
 * Build a partial snapshot from the code-action arguments (pure; testable).
 *
 * The full-file `getText()` is the one costly field here, so it is gated behind
 * `includeContent`: path / language / selection / diagnostics are all cheap, and
 * the snapshot only drives matching (the run re-captures at launch). Callers pass
 * `false` when no installed skill binds the file's content, so a selection- or
 * diagnostics-only skill never pays for a whole-file copy on every request.
 */
export function snapshotFromCodeAction(
    document: { uri: { fsPath: string }; languageId: string; getText: (range?: any) => string },
    range: { isEmpty: boolean },
    context: { diagnostics: ReadonlyArray<{ range: { start: { line: number } }; message: string }> },
    includeContent: boolean = true
): EditorContextSnapshot {
    const snapshot: EditorContextSnapshot = {
        activeFile: {
            path: document.uri.fsPath,
            content: includeContent ? document.getText() : '',
            languageId: document.languageId,
        },
    };
    if (!range.isEmpty) snapshot.selection = document.getText(range);
    if (context.diagnostics.length > 0) {
        snapshot.diagnostics = formatDiagnostics(context.diagnostics);
    }
    return snapshot;
}

export class SkillCodeActionProvider implements vscode.CodeActionProvider {
    constructor(private readonly skillRegistry: SkillRegistry) {}

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {
        const skills = this.skillRegistry.getAll();
        // Fast-path the common case: with no context-bound skill installed there is
        // nothing to offer, so skip snapshotting the document (a full getText copy)
        // — this runs on every cursor/selection change in every file.
        if (!anySkillBindsContext(skills)) return [];

        const snapshot = snapshotFromCodeAction(document, range, context, anySkillBindsFileContent(skills));
        const actions: vscode.CodeAction[] = [];
        for (const skill of skills) {
            if (!skillMatchesContext(skill, snapshot)) continue;
            const action = new vscode.CodeAction(`Skiller: Run ${skill.name}`, vscode.CodeActionKind.Empty);
            action.command = {
                command: 'skiller.runSkill',
                title: `Run ${skill.name}`,
                arguments: [skill.id],
            };
            actions.push(action);
        }
        return actions;
    }
}

export function registerSkillCodeActions(
    context: vscode.ExtensionContext,
    skillRegistry: SkillRegistry
): void {
    const provider = vscode.languages.registerCodeActionsProvider(
        { scheme: 'file' },
        new SkillCodeActionProvider(skillRegistry)
    );
    context.subscriptions.push(provider);
}
