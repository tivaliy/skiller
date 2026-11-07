/**
 * skiller_writeSkill Tool
 *
 * Lets the built-in AI skill creator write a complete, validated skill folder.
 * Validation and the atomic write live in the scaffold commit; this class only
 * adapts it to the language-model tool contract.
 *
 * Results are always returned as text (never thrown). Success starts with
 * `Skill written:`, failure with `Skill not written:`; neither may match
 * the runner's isToolResultError, or it would treat them as tool failures.
 * No confirmationMessages: the user already asked for the skill.
 *
 * @module tools/write-skill
 */

import * as vscode from 'vscode';
import type { CommitResult, CreatedSkill, SkillFileEntries } from '../scaffold/types';

export interface WriteSkillInput {
    id: string;
    files: Array<{ path: string; content: string }>;
}

export interface WriteSkillDeps {
    /** Files as sent (a repeated path is reported by the commit as a duplicate). */
    commit(id: string, files: SkillFileEntries): Promise<CommitResult>;
    finish(result: CreatedSkill): Promise<void>;
}

function text(value: string): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)]);
}

function notWritten(errors: string[]): vscode.LanguageModelToolResult {
    return text(
        'Skill not written:\n' +
        errors.map(e => `- ${e}`).join('\n') +
        '\nFix the listed problems and call skiller_writeSkill again, keeping the same id unless an error says it already exists (then pick a different id).'
    );
}

function isValidInput(input: unknown): input is WriteSkillInput {
    const i = input as Partial<WriteSkillInput> | undefined;
    return !!i && typeof i.id === 'string' && Array.isArray(i.files) &&
        i.files.every(f => !!f && typeof f.path === 'string' && typeof f.content === 'string');
}

export class WriteSkillTool implements vscode.LanguageModelTool<WriteSkillInput> {
    constructor(private readonly deps: WriteSkillDeps) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<WriteSkillInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const input: unknown = options.input;
        if (!isValidInput(input)) {
            return notWritten(['Input must be { id: string, files: [{ path: string, content: string }] }.']);
        }
        try {
            if (token.isCancellationRequested) {
                return text('Skill not written: the request was cancelled.');
            }
            const files = input.files.map(f => [f.path, f.content] as const);
            const result = await this.deps.commit(input.id, files);
            if (!result.ok) {
                return notWritten(result.errors);
            }
            // Fire-and-forget: a notification problem must never fail the write.
            void Promise.resolve()
                .then(() => this.deps.finish({ id: result.id, dir: result.dir, tier: result.tier }))
                .catch(e => console.warn('[skiller_writeSkill] finish failed', e));
            return text(
                `Skill written: "${result.id}" at ${result.dir}. ` +
                'It will be registered and opened for the user.'
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return notWritten([message]);
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<WriteSkillInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return { invocationMessage: `Writing skill: ${options.input?.id ?? ''}` };
    }
}
