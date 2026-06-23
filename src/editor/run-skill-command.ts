/**
 * Run Skill command
 *
 * Registers `skiller.runSkill`. Invoked with a skill id (from a code action)
 * runs it directly; invoked with none (palette/context-menu/keybinding) shows a
 * QuickPick. Either way it captures the editor snapshot NOW (before chat opens
 * moves focus), stashes it, and opens chat via launchSkill.
 */

import * as vscode from 'vscode';
import type { SkillRegistry, LaunchContextStore } from '../skills';
import { captureSnapshot, contextSourcesOf, createVsCodeContextAccessors, captureDeliveryTarget, outputNeedsTarget } from '../skills';
import { getSetting } from '../settings';
import { launchSkill } from './launch';

export function registerRunSkillCommand(
    context: vscode.ExtensionContext,
    skillRegistry: SkillRegistry,
    launchContextStore: LaunchContextStore
): void {
    const disposable = vscode.commands.registerCommand(
        'skiller.runSkill',
        async (skillId?: unknown) => {
            // A code action passes the skill id (string). The editor context menu
            // invokes the command with the document Uri as the first arg, so only
            // treat a string as an id — anything else falls through to the picker.
            const explicitId = typeof skillId === 'string' ? skillId : undefined;
            const id = explicitId ?? (await pickSkill(skillRegistry));
            if (!id) return; // user dismissed the QuickPick

            const skill = skillRegistry.getById(id);
            // Capture only the editor state this skill binds — a selection-only skill
            // shouldn't spawn the git-diff subprocesses it would never read.
            const snapshot = await captureSnapshot(
                createVsCodeContextAccessors(),
                skill ? contextSourcesOf(skill) : undefined,
            );
            // Capture the editor location too, so a write-back sink lands where the skill
            // was launched even after chat opens and moves focus — only such sinks need it.
            if (outputNeedsTarget(skill?.output?.to)) {
                const target = captureDeliveryTarget();
                if (target) launchContextStore.setTarget(id, target);
            }

            await launchSkill(id, snapshot, {
                stashContext: (sid, snap) => launchContextStore.set(sid, snap),
                getRunSurface: () => getSetting('skills.runSurface'),
                openChat: async (query, isPartialQuery) => {
                    await vscode.commands.executeCommand('workbench.action.chat.open', { query, isPartialQuery });
                },
            });
        }
    );
    context.subscriptions.push(disposable);
}

async function pickSkill(skillRegistry: SkillRegistry): Promise<string | undefined> {
    const items = skillRegistry.getAll().map(skill => ({
        label: skill.name,
        description: skill.id,
        detail: skill.description || undefined,
    }));
    if (items.length === 0) {
        void vscode.window.showInformationMessage('Skiller: no skills found.');
        return undefined;
    }
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select a skill to run' });
    return picked?.description; // description holds the skill id
}
