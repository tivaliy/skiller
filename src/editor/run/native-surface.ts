/**
 * NativeSurface: the VS Code implementation of the RunSurface port.
 *
 * Inputs are asked with QuickPick / InputBox; confirmations and tool approvals
 * appear as cards in the skill's graph panel, falling back to a modal when no
 * panel is open (or it closes while waiting) so a run never hangs
 * on an invisible card. Progress, problems, warnings and results are
 * notifications; details go to the output channel.
 *
 * The controller calls `progress` before any confirmation or approval, so the
 * run token received there is used to dismiss a waiting card when the run is
 * cancelled.
 */

import * as vscode from 'vscode';
import { describeSink, validateSingleInput, coerceValue } from '../../skills';
import type { Skill, SkillInput, SkillResult, PendingConfirmationInfo, ConfirmationOption } from '../../skills';
import type { ModelSource } from '../../skills/types';
import type { DeliveryOutcome } from '../../skills/output';
import type { RunSurface, ToolApproval, ToolCallRequest } from '../../skills/run';
import type { ProgressHooks } from '../../skills/progress-hooks';
import type { SkillGraphPanelManager } from '../../skills/graph/panel-manager';
import type { GraphCard } from '../../skills/graph/types';
import { fencedBlock } from '../../skills/utils';
import { renderCardMarkdown } from './markdown';
import { RunLog } from './run-log';

export interface NativeSurfaceDeps {
    /** Graph-panel cards. `getPanel` tells whether a result card can be shown without waiting. */
    panels: Pick<SkillGraphPanelManager, 'showCard' | 'clearCard' | 'getPanel'>;
    /** Open (or reveal) the skill's graph panel. */
    showGraph(skill: Skill): Promise<void>;
    /** Cancel the active run (the progress notification's Cancel button). */
    cancelRun(): void;
    /** Wording for a tool's approval (Skiller's own tools); undefined → the generic "Allow <tool>?" card. */
    describeTool?: (call: ToolCallRequest) => { title: string; markdown: string } | undefined;
    output: vscode.OutputChannel;
}

const SHOW_DETAILS = 'Show details';
const SHOW_LOG = 'Show log';
const REVIEW = 'Review';
const REPLACE_RUN = 'Cancel and run';

const APPROVAL_ACTIONS: ReadonlyArray<{ id: ToolApproval; label: string }> = [
    { id: 'once', label: 'Allow' },
    { id: 'run', label: 'Allow for this run' },
    { id: 'always', label: 'Always allow in this workspace' },
    { id: 'deny', label: 'Deny' },
];

const RESULT_ACTIONS = { open: 'open', copy: 'copy', log: 'log' } as const;

/** Tool-call outcomes worth a log line (the generic "Processing…" phases are not). */
const TOOL_PHASE = /^(Called |Error from |Refused: |Declined: |Failed: )/;

/** How long VS Code gets to report a just-revealed graph panel as visible. */
const REVEAL_GRACE_MS = 1000;

/** Why a step runs on its model, for the output log ('auto' = the run's fallback model). */
const MODEL_SOURCE_LABEL: Record<ModelSource, string> = {
    'skill-step': "the step's model",
    'skill-default': "the skill's models.default",
    auto: 'your model for Skiller runs',
};

/** A QuickPick item carrying the answer it stands for. */
type PickItem<T> = vscode.QuickPickItem & { answer: T };

export function createNativeSurface(deps: NativeSurfaceDeps): RunSurface {
    return new NativeSurface(deps);
}

class NativeSurface implements RunSurface {
    /** Increments per run (each `progress` call) so card ids never repeat across runs. */
    private runSeq = 0;
    private cardSeq = 0;
    /** The token of the run whose progress is showing; used to dismiss cards on cancel. */
    private runToken: vscode.CancellationToken | undefined;
    /** The running skill's transcript in the Skiller output channel. */
    private log: RunLog | undefined;

    constructor(private readonly deps: NativeSurfaceDeps) {}

    // -----------------------------------------------------------------------
    // Inputs
    // -----------------------------------------------------------------------

    async askInput(
        skill: Skill,
        input: SkillInput,
        position: { index: number; total: number },
        token: vscode.CancellationToken
    ): Promise<{ value: unknown } | 'cancelled'> {
        const title = `${skill.name} — ${input.name} (${position.index + 1} of ${position.total})`;
        const prompt = input.prompt ?? input.description;

        const choices = pickChoices(input);
        if (choices) {
            const picked = await vscode.window.showQuickPick(
                choices,
                { title, placeHolder: prompt, ignoreFocusOut: true },
                token
            );
            return picked ? { value: picked.answer } : 'cancelled';
        }

        const value = await vscode.window.showInputBox(
            {
                title,
                prompt,
                value: input.default !== undefined ? formatDefault(input.default) : undefined,
                ignoreFocusOut: true,
                validateInput: text => validateTyped(input, text)
            },
            token
        );
        return value === undefined ? 'cancelled' : { value };
    }

    // -----------------------------------------------------------------------
    // Confirmations
    // -----------------------------------------------------------------------

    async askConfirmation(skill: Skill, pending: PendingConfirmationInfo): Promise<ConfirmationOption | 'cancelled'> {
        const token = this.runToken;
        const log = this.logFor(skill); // this run's log, even if the answer comes late
        await this.revealGraph(skill);

        const actionId = await this.cardAnswer(skill, token, {
            cardId: this.nextCardId(pending.stepId),
            kind: 'confirmation',
            stepId: pending.stepId,
            title: stepTitle(skill, pending.stepId),
            html: await renderCardMarkdown(pending.message),
            actions: pending.options.map((option, index) => ({
                id: String(index),
                label: option.label,
                ...(index === 0 ? { primary: true } : {})
            }))
        });
        if (token?.isCancellationRequested) return 'cancelled';

        // Return the option itself: the controller matches the choice by identity.
        const fromCard = actionId !== undefined ? pending.options[Number(actionId)] : undefined;
        // No panel, or it closed while waiting: a modal, whose detail shows the whole message.
        const chosen = fromCard ?? await this.confirmInModal(skill, pending);
        if (chosen !== 'cancelled' && !token?.isCancellationRequested) {
            log.answered(stepTitle(skill, pending.stepId), chosen.label);
        }
        return chosen;
    }

    private async confirmInModal(skill: Skill, pending: PendingConfirmationInfo): Promise<ConfirmationOption | 'cancelled'> {
        const label = await vscode.window.showInformationMessage(
            skill.name,
            { modal: true, detail: pending.message },
            ...pending.options.map(option => option.label)
        );
        return pending.options.find(option => option.label === label) ?? 'cancelled';
    }

    // -----------------------------------------------------------------------
    // Tool approvals
    // -----------------------------------------------------------------------

    async approveTool(skill: Skill, call: ToolCallRequest): Promise<ToolApproval> {
        const token = this.runToken;
        const log = this.logFor(skill); // this run's log, even if the answer comes late
        const described = this.deps.describeTool?.(call);
        const json = describeToolInput(call.input);
        const title = described?.title ?? `Allow ${call.toolName}?`;
        const markdown = described?.markdown ?? fencedBlock(json, 'json');
        await this.revealGraph(skill);

        const actionId = await this.cardAnswer(skill, token, {
            cardId: this.nextCardId(`tool:${call.toolName}`),
            kind: 'toolApproval',
            title,
            html: await renderCardMarkdown(markdown),
            actions: APPROVAL_ACTIONS.map((action, index) => ({
                id: action.id,
                label: action.label,
                ...(index === 0 ? { primary: true } : {})
            }))
        });
        if (token?.isCancellationRequested) return 'deny';

        let answer = APPROVAL_ACTIONS.find(action => action.id === actionId);
        if (!answer) {
            // No panel, or it closed while waiting: a modal with the same choices.
            const label = await vscode.window.showWarningMessage(
                title,
                { modal: true, detail: described?.markdown ?? json },
                ...APPROVAL_ACTIONS.map(action => action.label)
            );
            answer = APPROVAL_ACTIONS.find(action => action.label === label) ?? APPROVAL_ACTIONS[APPROVAL_ACTIONS.length - 1];
        }
        if (!token?.isCancellationRequested) log.answered(title, answer.label);
        return answer.id;
    }

    // -----------------------------------------------------------------------
    // Progress
    // -----------------------------------------------------------------------

    progress(skill: Skill, token: vscode.CancellationToken, inputs: Record<string, unknown>): ProgressHooks & { dispose(): void } {
        this.runSeq++;
        this.runToken = token;
        const log = this.newLog(skill);
        this.log = log;
        log.start(inputs);

        let report: ((message: string) => void) | undefined;
        let finish: (() => void) | undefined;
        let disposed = false;
        /** Pins that were unavailable, by step: the executor reports them before the step starts. */
        const unavailablePin = new Map<string, string>();

        void vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: skill.name, cancellable: true },
            (progress, progressToken) => {
                progressToken.onCancellationRequested(() => this.deps.cancelRun());
                report = message => progress.report({ message });
                return new Promise<void>(resolve => {
                    finish = resolve;
                    if (disposed) resolve();
                });
            }
        );

        return {
            onStepStart: (stepId, stepIndex, totalSteps, modelInfo) => {
                report?.(`${stepTitle(skill, stepId)} (${stepIndex + 1} of ${totalSteps})`);
                let model: { model: string; why: string } | undefined;
                if (modelInfo) {
                    const pin = unavailablePin.get(stepId);
                    const why = pin === undefined
                        ? MODEL_SOURCE_LABEL[modelInfo.source]
                        : `${MODEL_SOURCE_LABEL.auto}; '${pin}' isn't available`;
                    model = { model: modelInfo.displayName, why };
                }
                log.stepStarted(stepId, stepIndex, totalSteps, model);
            },
            onStepComplete: (stepId, success, duration, error, output) => {
                log.stepCompleted(stepId, success, duration, error, output);
            },
            onStepSkipped: (stepId, stepIndex, totalSteps, reason) => {
                log.stepSkipped(stepId, stepIndex, totalSteps, reason);
            },
            onPhaseComplete: phase => {
                if (TOOL_PHASE.test(phase)) log.toolEvent(phase);
            },
            onConfirmationRequired: () => {
                report?.('Waiting for you');
            },
            onModelFallback: (stepId, requestedModel, actualModel) => {
                unavailablePin.set(stepId, requestedModel);
                void vscode.window.showWarningMessage(
                    `${skill.name}: model '${requestedModel}' isn't available for step '${stepId}'; using '${actualModel}'.`
                );
            },
            dispose: () => {
                if (disposed) return;
                disposed = true;
                log.stopped(token.isCancellationRequested); // no-op once the result was logged
                if (this.log === log) this.log = undefined;
                finish?.();
                if (this.runToken === token) this.runToken = undefined;
            }
        };
    }

    // -----------------------------------------------------------------------
    // Run lock, problems, warnings
    // -----------------------------------------------------------------------

    async confirmReplaceRun(current: Skill, next: Skill): Promise<boolean> {
        const answer = await vscode.window.showWarningMessage(
            `'${current.name}' is still running. Cancel it and run '${next.name}'?`,
            { modal: true },
            REPLACE_RUN
        );
        return answer === REPLACE_RUN;
    }

    showProblems(_skill: Skill, title: string, lines: string[]): void {
        this.notify('error', title, title, lines);
    }

    showWarnings(skill: Skill, lines: string[]): void {
        const message = lines.length === 1
            ? `${skill.name}: ${lines[0]}`
            : `${skill.name}: ${lines.length} warnings`;
        this.notify('warning', message, `Warnings for '${skill.name}'`, lines);
    }

    // -----------------------------------------------------------------------
    // Result
    // -----------------------------------------------------------------------

    async showResult(skill: Skill, result: SkillResult, delivery: DeliveryOutcome): Promise<void> {
        const summary = result.summary?.trim() ? result.summary : undefined;

        const log = this.logFor(skill);
        if (!result.success) {
            const error = result.error ?? 'unknown error';
            log.failed(error);
            void vscode.window.showErrorMessage(`Skill '${skill.name}' failed: ${error}`, SHOW_LOG).then(choice => {
                if (choice === SHOW_LOG) this.deps.output.show(true);
            });
            return;
        }
        log.completed(result.duration);

        switch (delivery.kind) {
            case 'delivered':
                void vscode.window.showInformationMessage(delivery.fellBack
                    ? `${skill.name}: output opened in a new tab — there was no safe place to write it in the editor.`
                    : `${skill.name}: output ${describeSink(delivery.sink)}.`);
                return;
            case 'unknownSink':
                void vscode.window.showErrorMessage(
                    `${skill.name} completed, but 'output.to: ${delivery.to}' is not a recognized sink — output was not delivered.`
                );
                if (summary) await this.openDocument(summary);
                return;
            case 'failed':
                void vscode.window.showErrorMessage(
                    `${skill.name} completed, but delivering its output failed: ${delivery.message}`
                );
                if (summary) await this.openDocument(summary);
                return;
            case 'none':
                if (!summary || skill.output?.to) {
                    void vscode.window.showInformationMessage(`${skill.name} completed.`);
                    return;
                }
                if (this.deps.panels.getPanel(skill.id)) {
                    await this.showResultCard(skill, summary);
                } else {
                    await this.openDocument(summary);
                }
                return;
        }
    }

    /** Show the summary as a card; its buttons are handled later (the run does not wait). */
    private async showResultCard(skill: Skill, summary: string): Promise<void> {
        const cardId = this.nextCardId('result');
        const answer = this.deps.panels.showCard(skill.id, {
            cardId,
            kind: 'result',
            title: `${skill.name} — result`,
            html: await renderCardMarkdown(summary),
            actions: [
                { id: RESULT_ACTIONS.open, label: 'Open as document', primary: true },
                { id: RESULT_ACTIONS.copy, label: 'Copy' },
                { id: RESULT_ACTIONS.log, label: SHOW_LOG }
            ]
        });
        void answer.then(async actionId => {
            if (actionId === undefined) return; // replaced or panel closed
            this.deps.panels.clearCard(skill.id, cardId);
            if (actionId === RESULT_ACTIONS.open) {
                await this.openDocument(summary);
            } else if (actionId === RESULT_ACTIONS.copy) {
                await vscode.env.clipboard.writeText(summary);
                void vscode.window.showInformationMessage(`${skill.name}: result copied.`);
            } else if (actionId === RESULT_ACTIONS.log) {
                this.deps.output.show(true);
            }
        });
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Show a card and wait for its answer; a cancelled run clears the card (resolving undefined).
     * The "waiting" notice appears only if the card is still unanswered once VS Code has had
     * time to report the revealed panel's visibility, and the panel is still out of sight
     * (for example, the editor area is hidden behind a maximized chat).
     */
    private async cardAnswer(
        skill: Skill,
        token: vscode.CancellationToken | undefined,
        card: GraphCard
    ): Promise<string | undefined> {
        if (token?.isCancellationRequested) return undefined;
        const clearOnCancel = token?.onCancellationRequested(() => this.deps.panels.clearCard(skill.id, card.cardId));
        let settled = false;
        const recheck = setTimeout(() => {
            const panel = this.deps.panels.getPanel(skill.id);
            if (!settled && panel && !panel.visible && !token?.isCancellationRequested) this.notifyWaiting(skill);
        }, REVEAL_GRACE_MS);
        try {
            const actionId = await this.deps.panels.showCard(skill.id, card);
            if (actionId !== undefined) this.deps.panels.clearCard(skill.id, card.cardId);
            return actionId;
        } finally {
            settled = true;
            clearTimeout(recheck);
            clearOnCancel?.dispose();
        }
    }

    /** Non-modal "waiting" notice; Review brings the graph panel forward. */
    private notifyWaiting(skill: Skill): void {
        void vscode.window.showInformationMessage('Skiller is waiting for you', REVIEW).then(choice => {
            if (choice === REVIEW) void this.revealGraph(skill);
        });
    }

    private async revealGraph(skill: Skill): Promise<void> {
        try {
            await this.deps.showGraph(skill);
        } catch (error) {
            // A card that can't be shown falls back to a picker or modal.
            this.deps.output.appendLine(`Could not open the graph for '${skill.name}': ${errorMessage(error)}`);
        }
    }

    /**
     * A non-modal error or warning. Its lines go to the Skiller output channel right away,
     * next to the run log (so an error that ended a run is in its transcript); Show details
     * opens the channel.
     */
    private notify(severity: 'error' | 'warning', message: string, heading: string, lines: string[]): void {
        const { output } = this.deps;
        output.appendLine(heading);
        for (const line of lines) output.appendLine(line);
        output.appendLine('');
        const show = severity === 'error' ? vscode.window.showErrorMessage : vscode.window.showWarningMessage;
        void show(message, SHOW_DETAILS).then(choice => {
            if (choice === SHOW_DETAILS) output.show(true);
        });
    }

    private async openDocument(content: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
            await vscode.window.showTextDocument(document, { preview: false });
        } catch (error) {
            this.deps.output.appendLine(`Could not open the result: ${errorMessage(error)}`);
            this.deps.output.appendLine(content);
            this.deps.output.show(true);
        }
    }

    private newLog(skill: Skill): RunLog {
        return new RunLog(skill.name, { write: line => this.deps.output.appendLine(line) });
    }

    /** The running skill's log; a fresh one (no header) for a result shown outside a run. */
    private logFor(skill: Skill): RunLog {
        return this.log ?? this.newLog(skill);
    }

    private nextCardId(scope: string): string {
        return `${this.runSeq}:${scope}:${++this.cardSeq}`;
    }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** QuickPick choices for enum and boolean inputs (undefined → use an InputBox). */
function pickChoices(input: SkillInput): Array<PickItem<unknown>> | undefined {
    let items: Array<PickItem<unknown>>;
    if (input.enum && input.enum.length > 0) {
        items = input.enum.map(value => ({ label: value, answer: value }));
    } else if (input.type === 'boolean') {
        items = [{ label: 'Yes', answer: true }, { label: 'No', answer: false }];
    } else {
        return undefined;
    }

    for (const item of items) {
        if (item.answer === input.default) item.description = 'default';
    }
    // An optional input with no default can be left empty.
    if (!input.required && input.default === undefined) {
        items.push({ label: 'Skip', description: 'leave empty', answer: '' });
    }
    return items;
}

/** Live validation for an InputBox answer, mirroring how the controller parses it. */
function validateTyped(input: SkillInput, text: string): string | undefined {
    const value = text.trim();
    if (value === '') {
        // Empty takes the default, or skips an optional input.
        if (input.default !== undefined || !input.required) return undefined;
        return `Missing required input: ${input.name}`;
    }
    const typed = input.type === 'array' ? coerceValue(value, 'array') : value;
    const check = validateSingleInput(input, typed);
    return check.valid ? undefined : (check.error ?? `Invalid value for input '${input.name}'`);
}

function formatDefault(value: unknown): string {
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    return String(value);
}

function stepTitle(skill: Skill, stepId: string): string {
    return skill.steps.find(step => step.id === stepId)?.description ?? stepId;
}

function describeToolInput(input: unknown): string {
    try {
        return JSON.stringify(input, null, 2) ?? String(input);
    } catch {
        return String(input);
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
