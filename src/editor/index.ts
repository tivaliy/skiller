import type * as vscode from 'vscode';
import { registerRunCommands, type RunCommandsDeps } from './run/commands';
import { registerSkillCodeActions } from './code-action-provider';

export { SkillCodeActionProvider, snapshotFromCodeAction } from './code-action-provider';
export { registerScaffoldCommands } from './scaffold-commands';
export type { ScaffoldCommandDeps } from './scaffold-commands';
export { finishSkill } from './scaffold-finish';
export { recordInstallVersion, showMigrationNoticeOnce } from './migration-notice';
export { createNativeSurface } from './run';
export { createSkillerStatusBar } from './status-bar';
export { watchSkillFolders } from './skill-watcher';
export type { NativeSurfaceDeps } from './run';
export type { RunCommandsDeps } from './run/commands';

/** Wire up editor-native triggers: the run commands and the skill code actions. */
export function registerTriggers(context: vscode.ExtensionContext, deps: RunCommandsDeps): void {
    registerRunCommands(context, deps);
    registerSkillCodeActions(context, deps.registry);
}
