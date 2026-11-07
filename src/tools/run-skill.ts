/**
 * skiller_runSkill Tool
 *
 * Lets an agent run a Skiller workflow through the native runner. The run shows
 * its own UI in VS Code (inputs, confirmations, progress), so the tool waits for
 * the outcome, up to waitCapMs; after that it returns and the run carries on.
 * Cancelling the tool's token cancels the run (it is passed as RunRequest.token).
 *
 * The harness adds no approval for extension tools, so prepareInvocation always
 * asks. Results are text, never thrown.
 *
 * @module tools/run-skill
 */

import * as vscode from 'vscode';
import type { Skill } from '../skills/types';
import type { RunOutcome, RunRequest } from '../skills/run/types';
import type { DeliveryOutcome, DeliveryTarget } from '../skills/output/types';
import { describeSink } from '../skills/output';

export interface RunSkillInput {
    id: string;
    inputs?: Record<string, unknown>;
}

export interface RunSkillDeps {
    find(id: string): Skill | undefined;
    /** Ids of the runnable skills, for the unknown-id message. */
    ids(): string[];
    run(req: RunRequest): Promise<RunOutcome>;
    captureTarget(skill: Skill): DeliveryTarget | undefined;
    /** How long invoke waits for the run before handing over to VS Code (600_000). */
    waitCapMs: number;
}

const CAP_TEXT = 'The run continues in VS Code; see the graph panel for the result.';

function text(value: string): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)]);
}

function describeDelivery(delivery: DeliveryOutcome): string {
    switch (delivery.kind) {
        case 'delivered': return `Output ${describeSink(delivery.sink)}.`;
        case 'unknownSink': return `Output not delivered: unknown destination "${delivery.to}".`;
        case 'failed': return `Output not delivered: ${delivery.message}`;
        default: return '';
    }
}

function describeOutcome(outcome: RunOutcome): string {
    switch (outcome.kind) {
        case 'completed': {
            const { result, delivery } = outcome;
            if (!result.success) {
                return `The skill failed: ${result.error ?? 'unknown error'}`;
            }
            return [result.summary ?? 'The skill completed.', describeDelivery(delivery)].filter(Boolean).join('\n\n');
        }
        case 'cancelled': return 'The run was cancelled.';
        case 'failed': return outcome.message;
        case 'notStarted': return outcome.reason;
    }
}

export class RunSkillTool implements vscode.LanguageModelTool<RunSkillInput> {
    constructor(private readonly deps: RunSkillDeps) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<RunSkillInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { id, inputs } = options.input ?? ({} as Partial<RunSkillInput>);
        const skill = typeof id === 'string' ? this.deps.find(id) : undefined;
        if (!skill) {
            return text(`Unknown skill "${String(id)}". Valid ids: ${this.deps.ids().join(', ') || '(none)'}.`);
        }

        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const run = this.deps.run({ skill, inputs, target: this.deps.captureTarget(skill), token });
            const cap = new Promise<'cap'>(resolve => { timer = setTimeout(() => resolve('cap'), this.deps.waitCapMs); });
            const winner = await Promise.race([run, cap]);
            return text(winner === 'cap' ? CAP_TEXT : describeOutcome(winner));
        } catch (error) {
            return text(`The run could not be completed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (timer) { clearTimeout(timer); }
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<RunSkillInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const id = options.input?.id;
        const skill = typeof id === 'string' ? this.deps.find(id) : undefined;
        const name = skill?.name ?? String(id);
        const given = Object.entries(options.input?.inputs ?? {});
        const lines = given.map(([k, v]) => `- \`${k}\`: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
        const markdown = `Run **${name}**?` + (lines.length ? `\n\nInputs:\n${lines.join('\n')}` : '');
        return {
            invocationMessage: `Running Skiller skill ${name}…`,
            confirmationMessages: { title: 'Run Skiller skill', message: new vscode.MarkdownString(markdown) }
        };
    }
}
