/**
 * Skill CodeLens Provider
 *
 * Provides clickable "Show Graph" links above skill.yaml files.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { parseSkill } from '../parser';
import { showSkillGraph } from './index';

/**
 * Command ID for showing skill graph
 */
export const SHOW_GRAPH_COMMAND = 'skiller.showSkillGraph';

/**
 * CodeLens provider for skill.yaml files
 */
export class SkillCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    /**
     * Provide CodeLens items for skill.yaml files
     */
    provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.CodeLens[] | null {
        // Only for skill.yaml files
        if (!document.fileName.endsWith('skill.yaml')) {
            return null;
        }

        const codeLenses: vscode.CodeLens[] = [];
        const range = new vscode.Range(0, 0, 0, 0);

        // Add "Show Graph" CodeLens
        codeLenses.push(
            new vscode.CodeLens(range, {
                title: '$(type-hierarchy) Show Graph',
                command: SHOW_GRAPH_COMMAND,
                arguments: [document.uri]
            })
        );

        return codeLenses;
    }
}

/**
 * Create a command handler for showing skill graphs
 *
 * @param extensionUri - Extension URI for resolving bundled assets
 */
function createShowGraphHandler(extensionUri: vscode.Uri) {
    return async (uri: vscode.Uri): Promise<void> => {
        const skillDir = path.dirname(uri.fsPath);

        // Parse the skill from the directory (async for remote/virtual FS)
        const result = await parseSkill(skillDir, {
            type: 'workspace',
            path: skillDir
        });

        if (!result.success) {
            void vscode.window.showErrorMessage(`Failed to parse skill: ${result.error?.error}`);
            return;
        }

        // Show the graph with bundled assets
        await showSkillGraph(result.skill!, extensionUri, {
            webview: { preserveFocus: true }
        });
    };
}

/**
 * Register the CodeLens provider and command
 * Call this from extension.ts activate()
 */
export function registerSkillCodeLens(context: vscode.ExtensionContext): void {
    // Register the CodeLens provider for skill.yaml files
    const provider = new SkillCodeLensProvider();

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { pattern: '**/skill.yaml' },
            provider
        )
    );

    // Register the command with extensionUri for bundled assets
    context.subscriptions.push(
        vscode.commands.registerCommand(
            SHOW_GRAPH_COMMAND,
            createShowGraphHandler(context.extensionUri)
        )
    );
}
