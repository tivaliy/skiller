/**
 * skiller_listSkills Tool
 *
 * Lets an agent discover the Skiller workflows it can run with skiller_runSkill.
 * Read-only; the result is a JSON array as text (never thrown).
 *
 * Exclusion rule: a skill that references a built-in-only tool
 * (builtinOnlyToolsUsedBy) is listed only when it is a built-in itself, because
 * a workspace or user skill using one cannot run. Built-ins such as
 * skill-creator and greeter stay listed.
 *
 * @module tools/list-skills
 */

import * as vscode from 'vscode';
import type { Skill } from '../skills/types';
import { builtinOnlyToolsUsedBy } from '../skills/reserved-tools';
import { outputNeedsTarget } from '../skills/output';

export interface ListSkillsDeps {
    skills(): Skill[];
}

export class ListSkillsTool implements vscode.LanguageModelTool<Record<string, never>> {
    constructor(private readonly deps: ListSkillsDeps) {}

    async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        let value: string;
        try {
            const listed = this.deps.skills()
                .filter(s => s.source.type === 'builtin' || builtinOnlyToolsUsedBy(s).length === 0)
                .map(s => ({
                    id: s.id,
                    name: s.name,
                    description: s.description,
                    inputs: s.inputs.map(i => ({
                        name: i.name,
                        type: i.type,
                        description: i.description,
                        required: i.required,
                        editorBound: i.from !== undefined
                    })),
                    writesToEditor: outputNeedsTarget(s.output?.to)
                }));
            value = JSON.stringify(listed, null, 2);
        } catch (error) {
            value = `Could not list skills: ${error instanceof Error ? error.message : String(error)}`;
        }
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)]);
    }

    async prepareInvocation(): Promise<vscode.PreparedToolInvocation> {
        return { invocationMessage: 'Listing Skiller skills…' };
    }
}
