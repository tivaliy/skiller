/** Editor surface: registers the New/Copy Skill palette commands and implements the scaffold UI port. */
import * as vscode from 'vscode';
import { createVsCodeScaffoldFs } from '../scaffold/fs';
import { finishSkill, type FinishDeps } from './scaffold-finish';
import { resolveTarget } from '../scaffold/target';
import { runNewSkillFlow, type ScaffoldUi } from '../scaffold/flow';
import { COPY_SKILL_COMMAND, NEW_SKILL_COMMAND, NEW_SKILL_KINDS, type NewSkillKind } from '../scaffold/kinds';
import { copyableBuiltins, type ScaffoldKind, type ScaffoldSource, type SourceEnv } from '../scaffold/sources/registry';
import { validateStagedSkill } from '../scaffold/validate-staged';
import type { RunController } from '../skills/run';

/** The built-in skill that writes a new skill from a described idea. */
const SKILL_CREATOR_ID = 'skill-creator';

export interface ScaffoldCommandDeps extends FinishDeps {
    /** Runs the skill-creator for New Skill → Describe. */
    controller: Pick<RunController, 'run'>;
}

const KIND_ITEMS: Array<vscode.QuickPickItem & { flow: NewSkillKind }> = NEW_SKILL_KINDS.map((k) => ({
    flow: k.kind,
    label: k.label,
    description: k.description,
}));

const SOURCE_GROUPS: Record<ScaffoldSource['kind'], string> = {
    template: 'Templates',
    example: 'Examples',
    builtin: 'Built-in skills',
};

function createUi(deps: ScaffoldCommandDeps): ScaffoldUi {
    return {
        async pickKind() {
            return (await vscode.window.showQuickPick(KIND_ITEMS, { title: 'New Skill', placeHolder: 'How do you want to start?' }))?.flow;
        },
        async pickSource(sources) {
            const items: Array<vscode.QuickPickItem & { source?: ScaffoldSource }> = [];
            let group: string | undefined;
            for (const source of sources) {
                const g = SOURCE_GROUPS[source.kind];
                if (g !== group) {
                    group = g;
                    items.push({ label: g, kind: vscode.QuickPickItemKind.Separator });
                }
                items.push({ label: source.label, description: source.detail, source });
            }
            return (await vscode.window.showQuickPick(items, { title: 'Pick a starting point' }))?.source;
        },
        async askId(suggested, validate) {
            return vscode.window.showInputBox({
                title: 'Skill id',
                prompt: 'Letters, digits, "-" and "_"; must start with a letter',
                value: suggested,
                validateInput: (v) => validate(v),
            });
        },
        async openDescribe() {
            // Ask for the idea, then run the skill-creator natively with it as input.
            const idea = (await vscode.window.showInputBox({
                title: 'New Skill — describe it',
                prompt: 'Describe the workflow you want Skiller to run',
                placeHolder: 'e.g. summarize my staged diff and let me approve before writing a CHANGELOG entry',
                ignoreFocusOut: true,
            }))?.trim();
            if (!idea) return; // dismissed or empty: do nothing
            const creator = deps.skillRegistry.getById(SKILL_CREATOR_ID);
            if (!creator) {
                void vscode.window.showErrorMessage(`Skiller: the ${SKILL_CREATOR_ID} skill is not available.`);
                return;
            }
            // Straight to the controller, skipping runSkill()'s delivery-target capture: safe
            // only while skill-creator has no editor `output.to` (it writes via skiller_writeSkill).
            await deps.controller.run({ skill: creator, inputs: { idea } });
        },
        showErrors(errors) {
            void vscode.window.showErrorMessage(`Skill not created: ${errors.join(' ')}`);
        },
    };
}

async function listDirs(dir: string): Promise<string[]> {
    try {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
        return entries
            .filter(([name, type]) => (type & vscode.FileType.Directory) !== 0 && !name.startsWith('.'))
            .map(([name]) => name);
    } catch {
        return [];
    }
}

export function registerScaffoldCommands(context: vscode.ExtensionContext, deps: ScaffoldCommandDeps): void {
    const { skillRegistry } = deps;
    const run = async (kind?: NewSkillKind, sourceId?: string, sourceKind?: ScaffoldKind): Promise<void> => {
        const env: SourceEnv = {
            extensionPath: context.extensionPath,
            builtins: copyableBuiltins(skillRegistry.getBySource().builtin),
            listDirs,
        };
        const target = resolveTarget(skillRegistry);
        await runNewSkillFlow(
            {
                ui: createUi(deps),
                env,
                fs: createVsCodeScaffoldFs(),
                target,
                takenIds: () => skillRegistry.getAll().map((s) => s.id),
                // Templates and copies are shipped files the user is about to edit: tool readiness
                // is checked when the skill runs, not here (AI-written skills keep the full check).
                validate: (dir) => validateStagedSkill(dir, { checkTools: false }),
                finish: (result) => finishSkill(result, deps),
            },
            kind,
            sourceId,
            sourceKind,
        );
    };

    context.subscriptions.push(
        vscode.commands.registerCommand(NEW_SKILL_COMMAND, (kind?: NewSkillKind, sourceId?: string) => run(kind, sourceId)),
        // ⎘ Copy in /skills is offered on built-ins only, so the id names a built-in.
        vscode.commands.registerCommand(COPY_SKILL_COMMAND, (skillId?: string) => run('copy', skillId, skillId ? 'builtin' : undefined)),
    );
}
