import type * as vscode from 'vscode';
import type { SkillRegistry, LaunchContextStore } from '../skills';
import { registerRunSkillCommand } from './run-skill-command';
import { registerSkillCodeActions } from './code-action-provider';

export { SkillCodeActionProvider, snapshotFromCodeAction } from './code-action-provider';

/** Wire up editor-native triggers. */
export function registerTriggers(
    context: vscode.ExtensionContext,
    skillRegistry: SkillRegistry,
    launchContextStore: LaunchContextStore
): void {
    registerRunSkillCommand(context, skillRegistry, launchContextStore);
    registerSkillCodeActions(context, skillRegistry);
}
