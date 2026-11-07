/**
 * Run commands: the palette commands that drive native runs.
 *
 *   skiller.runSkill            pick (if no id) → stash editor context → run
 *   skiller.showSkills          pick a skill → Run / Show Graph / Copy (built-ins)
 *   skiller.cancelRun           cancel the active run
 *   skiller.reloadSkills        rescan skills (and tools), refresh open graphs, forget removed skills' run state
 *   skiller.resetToolApprovals  forget every "Always allow" tool approval
 */

import * as vscode from 'vscode';
import type { Skill, SkillRegistry, LaunchContextStore, ExecutionStateManager } from '../../skills';
import { refreshOpenPanels } from '../../skills';
import { isCopyableBuiltin } from '../../skills/reserved-tools';
import type { RunController, ToolApprovalPolicy } from '../../skills/run';
import { COPY_SKILL_COMMAND } from '../../scaffold/kinds';
import { runSkill, pickSkill } from '../run-skill-command';

export interface RunCommandsDeps {
    controller: RunController;
    registry: SkillRegistry;
    policy: ToolApprovalPolicy;
    launchStore: LaunchContextStore;
    showGraph(skill: Skill): Promise<void>;
    /** Per-skill run state (graph highlights, step inspection); reset for skills that disappear on reload. */
    executionState: Pick<ExecutionStateManager, 'reset'>;
    /** Rescan the language-model tools (Reload Skills refreshes them too, so readiness sees new MCP servers). */
    reloadTools?(): void;
}

type SkillAction = 'run' | 'graph' | 'copy';

export function registerRunCommands(context: vscode.ExtensionContext, deps: RunCommandsDeps): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('skiller.runSkill', (skillId?: unknown) => runSkill(deps, skillId)),
        vscode.commands.registerCommand('skiller.showSkills', () => showSkills(deps)),
        vscode.commands.registerCommand('skiller.cancelRun', () => cancelRun(deps)),
        vscode.commands.registerCommand('skiller.reloadSkills', () => reloadSkills(deps)),
        vscode.commands.registerCommand('skiller.resetToolApprovals', () => resetToolApprovals(deps)),
    );
}

async function showSkills(deps: RunCommandsDeps): Promise<void> {
    const id = await pickSkill(deps.registry, 'Select a skill');
    const skill = id ? deps.registry.getById(id) : undefined;
    if (!skill) return;

    const actions: Array<vscode.QuickPickItem & { action: SkillAction }> = [
        { action: 'run', label: '$(play) Run' },
        { action: 'graph', label: '$(type-hierarchy) Show Graph' },
    ];
    // Built-ins using built-in-only tools are not copyable: a copy could not run.
    if (isCopyableBuiltin(skill)) {
        actions.push({ action: 'copy', label: '$(copy) Copy to Workspace…' });
    }
    const picked = await vscode.window.showQuickPick(actions, { title: skill.name, placeHolder: skill.description || skill.id });

    switch (picked?.action) {
        case 'run':
            await runSkill(deps, skill.id);
            return;
        case 'graph':
            await deps.showGraph(skill);
            return;
        case 'copy':
            await vscode.commands.executeCommand(COPY_SKILL_COMMAND, skill.id);
            return;
    }
}

function cancelRun(deps: RunCommandsDeps): void {
    if (!deps.controller.cancelActive()) {
        void vscode.window.showInformationMessage('Skiller: no skill is running.');
    }
}

async function reloadSkills(deps: RunCommandsDeps): Promise<void> {
    const { registry } = deps;
    deps.reloadTools?.();
    const diff = await registry.refreshWithDiff();
    // Re-render open graphs from the fresh registry; close those whose skill is gone.
    await refreshOpenPanels(id => registry.getById(id));
    // Drop leftover highlights and captured steps of skills that no longer exist.
    for (const id of diff.removed) {
        deps.executionState.reset(id);
    }

    const parts = [`${diff.added.length} added`, `${diff.removed.length} removed`];
    if (diff.newParseErrors.length > 0) {
        parts.push(`parse errors in ${diff.newParseErrors.join(', ')}`);
    }
    void vscode.window.showInformationMessage(`Skiller: reloaded ${diff.afterCount} skills (${parts.join(', ')}).`);
}

async function resetToolApprovals(deps: RunCommandsDeps): Promise<void> {
    await deps.policy.resetAlways();
    void vscode.window.showInformationMessage('Skiller: tool approvals reset — every tool will ask again.');
}
