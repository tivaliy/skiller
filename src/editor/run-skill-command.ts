/**
 * Run Skill
 *
 * The `skiller.runSkill` flow. Invoked with a skill id (from a code action or
 * Show Skills) it runs that skill; invoked with none (palette/context-menu/
 * keybinding) it shows a QuickPick. Either way it captures the editor snapshot
 * and delivery target NOW — before the run's pickers move focus — stashes them
 * in the launch store, and runs the skill natively through the RunController.
 */

import * as vscode from 'vscode';
import type { SkillRegistry, LaunchContextStore } from '../skills';
import type { RunController } from '../skills/run';
import { captureSnapshot, contextSourcesOf, createVsCodeContextAccessors, captureDeliveryTarget, outputNeedsTarget } from '../skills';

export interface RunSkillDeps {
    controller: RunController;
    registry: SkillRegistry;
    launchStore: LaunchContextStore;
}

/**
 * Run a skill natively. A code action passes the skill id (string); the editor
 * context menu passes the document Uri, so only a string is treated as an id —
 * anything else falls through to the picker.
 */
export async function runSkill(deps: RunSkillDeps, skillId?: unknown): Promise<void> {
    const { controller, registry, launchStore } = deps;
    const explicitId = typeof skillId === 'string' ? skillId : undefined;
    const id = explicitId ?? (await pickSkill(registry));
    if (!id) return; // user dismissed the QuickPick

    const skill = registry.getById(id);
    if (!skill) {
        void vscode.window.showErrorMessage(`Skiller: skill '${id}' not found.`);
        return;
    }

    // Capture only the editor state this skill binds — a selection-only skill
    // shouldn't spawn the git-diff subprocesses it would never read.
    const snapshot = await captureSnapshot(createVsCodeContextAccessors(), contextSourcesOf(skill));
    launchStore.set(id, snapshot);
    // Capture the editor location too, so a write-back sink lands where the skill
    // was launched even after the run's pickers move focus — only such sinks need it.
    if (outputNeedsTarget(skill.output?.to)) {
        const target = captureDeliveryTarget({ excludeDir: skill.source.path });
        if (target) launchStore.setTarget(id, target);
    }

    await controller.run({ skill });
}

/** Ask which skill to run (or show). Resolves to its id, or undefined when dismissed. */
export async function pickSkill(registry: SkillRegistry, placeHolder = 'Select a skill to run'): Promise<string | undefined> {
    const items = registry.getAll().map(skill => ({
        label: skill.name,
        description: skill.id,
        detail: skill.description || undefined,
    }));
    if (items.length === 0) {
        void vscode.window.showInformationMessage('Skiller: no skills found.');
        return undefined;
    }
    const picked = await vscode.window.showQuickPick(items, { placeHolder });
    return picked?.description; // description holds the skill id
}
