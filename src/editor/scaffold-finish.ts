/** Editor surface: post-create steps (refresh, open files/graph, notify). Never throws. */
import * as vscode from 'vscode';
import type { SkillRegistry } from '../skills/SkillRegistry';
import { refreshOpenPanels, showSkillGraph } from '../skills';
import type { CreatedSkill } from '../scaffold/types';

export interface FinishDeps {
    skillRegistry: SkillRegistry;
    extensionUri: vscode.Uri;
}

/** The parenthetical notes appended to the "created" notification. */
export function finishNote(skill: Pick<CreatedSkill, 'tier' | 'overridesBuiltin'>): string {
    const notes: string[] = [];
    if (skill.tier === 'user') {
        notes.push('(saved to your user skills — no workspace is open)');
    }
    if (skill.overridesBuiltin) {
        notes.push('(overrides the built-in)');
    }
    return notes.join(' ');
}

async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
    try {
        await fn();
    } catch (e) {
        console.error(`Skiller scaffold finish: ${name} failed`, e);
    }
}

export async function finishSkill(result: CreatedSkill, deps: FinishDeps): Promise<void> {
    const { skillRegistry, extensionUri } = deps;
    const { id, dir } = result;
    const note = finishNote(result);
    // Opening skill.yaml doesn't depend on the registry, so it runs alongside the rescan.
    await Promise.all([
        (async () => {
            await step('refresh', () => skillRegistry.refresh());
            await step('refreshOpenPanels', () => refreshOpenPanels((sid) => skillRegistry.getById(sid)));
        })(),
        step('open skill.yaml', async () => {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(`${dir}/skill.yaml`));
            await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
        }),
    ]);
    await step('graph', async () => {
        const skill = skillRegistry.getById(id);
        if (skill) {
            await showSkillGraph(skill, extensionUri, { webview: { preserveFocus: true } });
        }
    });
    await step('notify', async () => {
        const text = `Skill \`${id}\` created.${note ? ` ${note}` : ''}`;
        void Promise.resolve(vscode.window.showInformationMessage(text, 'Run it now', 'Reveal in Explorer'))
            .then((choice) => {
                if (choice === 'Run it now') {
                    return vscode.commands.executeCommand('skiller.runSkill', id);
                }
                if (choice === 'Reveal in Explorer') {
                    return vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(dir));
                }
                return undefined;
            })
            .catch((e: unknown) => console.error('Skiller scaffold finish: notification failed', e));
    });
}
