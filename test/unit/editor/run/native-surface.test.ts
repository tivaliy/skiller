/**
 * NativeSurface: the VS Code implementation of the RunSurface port — pickers for
 * inputs, graph-panel cards (with QuickPick / modal fallbacks) for confirmations
 * and tool approvals, notifications for progress, problems and results.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import * as vscode from 'vscode';
import type { CancellationToken, OutputChannel } from 'vscode';
import { createNativeSurface } from '../../../../src/editor/run';
import type { NativeSurfaceDeps } from '../../../../src/editor/run';
import type { GraphCard } from '../../../../src/skills/graph/types';
import type { RunSurface } from '../../../../src/skills/run';
import type { Skill, SkillInput, SkillResult, ConfirmationOption, PendingConfirmationInfo } from '../../../../src/skills/types';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

class FakeCancellation {
    private listeners: Array<() => void> = [];
    private cancelled = false;
    readonly token: CancellationToken;

    constructor() {
        const self = this;
        this.token = {
            get isCancellationRequested() { return self.cancelled; },
            onCancellationRequested: (listener: () => void) => {
                self.listeners.push(listener);
                return { dispose: () => { self.listeners = self.listeners.filter(l => l !== listener); } };
            },
        } as unknown as CancellationToken;
    }

    cancel(): void {
        if (this.cancelled) return;
        this.cancelled = true;
        for (const l of [...this.listeners]) l();
    }
}

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void }
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const OPTIONS: ConfirmationOption[] = [
    { label: 'Continue', action: 'continue' },
    { label: 'Revise', action: 'goto', gotoStep: 'draft' },
    { label: 'Cancel', action: 'abort' },
];

function makeSkill(overrides: Partial<Skill> = {}): Skill {
    return {
        id: 'writer',
        name: 'Writer',
        description: 'test',
        version: '1.0.0',
        inputs: [],
        tools: { aliases: {} },
        steps: [
            { id: 'draft', type: 'llm', description: 'Write the draft', message: 'x', output: 'draft' },
            { id: 'review', type: 'confirmation', message: 'Look good?', options: OPTIONS },
        ],
        onError: 'continue',
        source: { type: 'builtin', path: '/mock/writer' },
        ...overrides,
    };
}

function pending(): PendingConfirmationInfo {
    return { stepIndex: 1, stepId: 'review', message: '**Look** good?', options: OPTIONS };
}

function result(overrides: Partial<SkillResult> = {}): SkillResult {
    return {
        skillId: 'writer',
        success: true,
        steps: [],
        context: { inputs: {}, outputs: {} } as unknown as SkillResult['context'],
        duration: 5,
        summary: '# Done\n\nAll good.',
        ...overrides,
    };
}

function input(overrides: Partial<SkillInput>): SkillInput {
    return { name: 'tone', type: 'string', description: 'The tone', required: true, ...overrides };
}

const position = { index: 1, total: 3 };

const WINDOW_FNS = [
    'showQuickPick', 'showInputBox', 'showInformationMessage', 'showWarningMessage',
    'showErrorMessage', 'withProgress', 'createOutputChannel', 'showTextDocument',
] as const;

describe('NativeSurface', () => {
    let panels: { showCard: ReturnType<typeof vi.fn>; clearCard: ReturnType<typeof vi.fn>; getPanel: ReturnType<typeof vi.fn> };
    let showGraph: ReturnType<typeof vi.fn>;
    let cancelRun: ReturnType<typeof vi.fn>;
    let output: { appendLine: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn> };
    let surface: RunSurface;
    let run: FakeCancellation;

    // The mock's window functions are plain vi.fn()s; vscode's overloaded signatures get in the way of typing them.
    const window = vscode.window as unknown as Record<typeof WINDOW_FNS[number], Mock>;
    const doc = { uri: 'untitled:1' };

    beforeEach(() => {
        for (const name of WINDOW_FNS) window[name].mockReset();
        vi.mocked(vscode.commands.executeCommand).mockReset();
        vi.mocked(vscode.workspace.openTextDocument).mockReset();
        vi.mocked(vscode.env.clipboard.writeText).mockReset();

        window.showInformationMessage.mockResolvedValue(undefined);
        window.showWarningMessage.mockResolvedValue(undefined);
        window.showErrorMessage.mockResolvedValue(undefined);
        vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(doc as never);

        panels = { showCard: vi.fn(), clearCard: vi.fn(), getPanel: vi.fn() };
        showGraph = vi.fn(async () => {});
        cancelRun = vi.fn();
        output = { appendLine: vi.fn(), show: vi.fn() };
        surface = makeSurface();
        run = new FakeCancellation();
    });

    function makeSurface(extra: Partial<NativeSurfaceDeps> = {}): RunSurface {
        return createNativeSurface({
            panels: panels as unknown as NativeSurfaceDeps['panels'],
            showGraph,
            cancelRun,
            output: output as unknown as OutputChannel,
            ...extra,
        });
    }

    /** Start a run's progress so the surface knows the run token (as the controller does). */
    function startRun(skill: Skill = makeSkill()) {
        return surface.progress(skill, run.token);
    }

    // -----------------------------------------------------------------------
    // askInput
    // -----------------------------------------------------------------------

    describe('askInput', () => {
        it('askInput uses a QuickPick for enums with ignoreFocusOut', async () => {
            window.showQuickPick.mockImplementation(async (items: readonly vscode.QuickPickItem[]) => items[1]);

            const answer = await surface.askInput(
                makeSkill(),
                input({ enum: ['short', 'long'], prompt: 'Which tone?' }),
                position,
                run.token
            );

            expect(answer).toEqual({ value: 'long' });
            const [items, options, token] = window.showQuickPick.mock.calls[0];
            expect((items as vscode.QuickPickItem[]).map(i => i.label)).toEqual(['short', 'long']);
            expect(options).toMatchObject({ ignoreFocusOut: true, title: 'Writer — tone (2 of 3)', placeHolder: 'Which tone?' });
            expect(token).toBe(run.token);
            expect(window.showInputBox).not.toHaveBeenCalled();
        });

        it('asks a boolean as Yes/No', async () => {
            window.showQuickPick.mockImplementation(async (items: readonly vscode.QuickPickItem[]) => items.find(i => i.label === 'No'));

            const answer = await surface.askInput(makeSkill(), input({ name: 'deep', type: 'boolean' }), position, run.token);

            expect(answer).toEqual({ value: false });
            expect((window.showQuickPick.mock.calls[0][0] as vscode.QuickPickItem[]).map(i => i.label)).toEqual(['Yes', 'No']);
            expect(window.showQuickPick.mock.calls[0][1]).toMatchObject({ ignoreFocusOut: true });
        });

        it('offers a skip item for an optional pick without a default', async () => {
            window.showQuickPick.mockImplementation(async (items: readonly vscode.QuickPickItem[]) => items[items.length - 1]);

            const answer = await surface.askInput(
                makeSkill(),
                input({ required: false, enum: ['short', 'long'] }),
                position,
                run.token
            );

            expect(answer).toEqual({ value: '' });
        });

        it('uses an InputBox prefilled with the default and validated live', async () => {
            window.showInputBox.mockResolvedValue('42');

            const answer = await surface.askInput(
                makeSkill(),
                input({ name: 'count', type: 'number', default: 3 }),
                { index: 0, total: 1 },
                run.token
            );

            expect(answer).toEqual({ value: '42' });
            const [options, token] = window.showInputBox.mock.calls[0];
            expect(options).toMatchObject({
                ignoreFocusOut: true,
                title: 'Writer — count (1 of 1)',
                prompt: 'The tone',
                value: '3',
            });
            expect(token).toBe(run.token);
            const validate = (options as vscode.InputBoxOptions).validateInput!;
            expect(validate('abc')).toContain('should be number');
            expect(validate('7')).toBeUndefined();
            expect(validate('')).toBeUndefined(); // empty takes the default
        });

        it('rejects an empty answer for a required input without a default', async () => {
            window.showInputBox.mockResolvedValue(undefined);

            const answer = await surface.askInput(makeSkill(), input({}), position, run.token);

            expect(answer).toBe('cancelled');
            const validate = (window.showInputBox.mock.calls[0][0] as vscode.InputBoxOptions).validateInput!;
            expect(validate('  ')).toContain('Missing required input');
        });
    });

    // -----------------------------------------------------------------------
    // askConfirmation
    // -----------------------------------------------------------------------

    describe('askConfirmation', () => {
        it('shows a card in the graph panel and returns the chosen option by reference', async () => {
            startRun();
            panels.getPanel.mockReturnValue({});
            panels.showCard.mockResolvedValue('1');
            const info = pending();

            const choice = await surface.askConfirmation(makeSkill(), info);

            expect(choice).toBe(info.options[1]);
            expect(showGraph).toHaveBeenCalled();
            const [skillId, card] = panels.showCard.mock.calls[0] as [string, GraphCard];
            expect(skillId).toBe('writer');
            expect(card).toMatchObject({
                kind: 'confirmation',
                stepId: 'review',
                actions: [
                    { id: '0', label: 'Continue', primary: true },
                    { id: '1', label: 'Revise' },
                    { id: '2', label: 'Cancel' },
                ],
            });
            expect(card.html).toContain('Look');
            expect(card.cardId).toContain('review');
            expect(panels.clearCard).toHaveBeenCalledWith('writer', card.cardId);
            expect(window.showInformationMessage).toHaveBeenCalledWith('Skiller is waiting for you', 'Review');
            expect(window.showQuickPick).not.toHaveBeenCalled();
        });

        it('gives every card a fresh id, so a stale answer cannot match', async () => {
            startRun();
            panels.showCard.mockResolvedValue('0');

            await surface.askConfirmation(makeSkill(), pending());
            await surface.askConfirmation(makeSkill(), pending());
            surface.progress(makeSkill(), new FakeCancellation().token); // next run
            await surface.askConfirmation(makeSkill(), pending());

            const ids = panels.showCard.mock.calls.map(c => (c[1] as GraphCard).cardId);
            expect(new Set(ids).size).toBe(3);
        });

        it('askConfirmation falls back to a modal showing the full message when no panel is open', async () => {
            startRun();
            panels.showCard.mockResolvedValue(undefined); // no panel: resolves undefined at once
            window.showInformationMessage.mockResolvedValue('Cancel' as never);
            const info = pending();

            const choice = await surface.askConfirmation(makeSkill(), info);

            expect(choice).toBe(info.options[2]); // by reference
            expect(window.showInformationMessage).toHaveBeenCalledTimes(1); // the modal only: no card to review
            expect(window.showInformationMessage).toHaveBeenCalledWith(
                'Writer',
                { modal: true, detail: '**Look** good?' },
                'Continue', 'Revise', 'Cancel'
            );
            expect(window.showQuickPick).not.toHaveBeenCalled();
        });

        it('falls back to the modal when the panel closes while the card waits', async () => {
            startRun();
            const card = deferred<string | undefined>();
            panels.showCard.mockReturnValue(card.promise);
            window.showInformationMessage.mockResolvedValue('Continue' as never);
            const info = pending();

            const choice = surface.askConfirmation(makeSkill(), info);
            await flush();
            expect(window.showInformationMessage).not.toHaveBeenCalledWith('Writer', expect.anything(), 'Continue', 'Revise', 'Cancel');
            card.resolve(undefined); // panel disposed

            expect(await choice).toBe(info.options[0]);
        });

        it('askConfirmation returns cancelled when the fallback is dismissed', async () => {
            startRun();
            panels.showCard.mockResolvedValue(undefined);
            window.showInformationMessage.mockResolvedValue(undefined);

            expect(await surface.askConfirmation(makeSkill(), pending())).toBe('cancelled');
        });

        it('a cancelled run clears the waiting card and does not fall back', async () => {
            startRun();
            const card = deferred<string | undefined>();
            panels.showCard.mockReturnValue(card.promise);
            panels.clearCard.mockImplementation(() => card.resolve(undefined));

            const choice = surface.askConfirmation(makeSkill(), pending());
            await flush();
            run.cancel();

            expect(await choice).toBe('cancelled');
            expect(panels.clearCard).toHaveBeenCalled();
            expect(window.showInformationMessage).not.toHaveBeenCalled();
            expect(window.showQuickPick).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // approveTool
    // -----------------------------------------------------------------------

    describe('approveTool', () => {
        const call = { toolName: 'skiller_createFile', input: { path: 'a.md' } };

        it('approveTool maps card actions to approvals and dismissal to deny', async () => {
            startRun();
            for (const action of ['once', 'run', 'always', 'deny'] as const) {
                panels.showCard.mockResolvedValueOnce(action);
                expect(await surface.approveTool(makeSkill(), call)).toBe(action);
            }

            const card = panels.showCard.mock.calls[0][1] as GraphCard;
            expect(card).toMatchObject({
                kind: 'toolApproval',
                title: 'Allow skiller_createFile?',
                actions: [
                    { id: 'once', label: 'Allow', primary: true },
                    { id: 'run', label: 'Allow for this run' },
                    { id: 'always', label: 'Always allow in this workspace' },
                    { id: 'deny', label: 'Deny' },
                ],
            });
            expect(card.html).toContain('a.md');
            expect(panels.clearCard).toHaveBeenCalledTimes(4);

            // No panel: a modal with the same choices; dismissing it denies.
            panels.showCard.mockResolvedValue(undefined);
            window.showWarningMessage.mockResolvedValueOnce(undefined);
            expect(await surface.approveTool(makeSkill(), call)).toBe('deny');
            const [message, options, ...choices] = window.showWarningMessage.mock.calls.at(-1)!;
            expect(message).toBe('Allow skiller_createFile?');
            expect(options).toMatchObject({ modal: true });
            expect(choices).toEqual(['Allow', 'Allow for this run', 'Always allow in this workspace', 'Deny']);

            window.showWarningMessage.mockResolvedValueOnce('Always allow in this workspace' as never);
            expect(await surface.approveTool(makeSkill(), call)).toBe('always');
        });

        it('uses the Skiller wording for a described tool, on the card and in the modal', async () => {
            const describeTool = vi.fn((c: { toolName: string }) => c.toolName === 'skiller_createFile'
                ? { title: 'Create File', markdown: 'Create file at **a.md**?' }
                : undefined);
            const described = makeSurface({ describeTool });
            described.progress(makeSkill(), run.token);

            panels.showCard.mockResolvedValueOnce('run');
            expect(await described.approveTool(makeSkill(), call)).toBe('run');
            expect(describeTool).toHaveBeenCalledWith(call);
            const card = panels.showCard.mock.calls[0][1] as GraphCard;
            expect(card.title).toBe('Create File');
            expect(card.html).toContain('Create file at');
            expect(card.html).not.toContain('"path"');

            panels.showCard.mockResolvedValueOnce(undefined);
            window.showWarningMessage.mockResolvedValueOnce('Allow' as never);
            expect(await described.approveTool(makeSkill(), call)).toBe('once');
            expect(window.showWarningMessage).toHaveBeenCalledWith(
                'Create File',
                { modal: true, detail: 'Create file at **a.md**?' },
                'Allow', 'Allow for this run', 'Always allow in this workspace', 'Deny'
            );
        });

        it('falls back to the generic card when the tool is not described', async () => {
            const described = makeSurface({ describeTool: () => undefined });
            described.progress(makeSkill(), run.token);
            panels.showCard.mockResolvedValueOnce('deny');

            expect(await described.approveTool(makeSkill(), { toolName: 'mcp_fetch', input: { url: 'x' } })).toBe('deny');
            const card = panels.showCard.mock.calls[0][1] as GraphCard;
            expect(card.title).toBe('Allow mcp_fetch?');
            expect(card.html).toContain('url');
        });

        it('a cancelled run denies without showing the modal', async () => {
            startRun();
            const card = deferred<string | undefined>();
            panels.showCard.mockReturnValue(card.promise);
            panels.clearCard.mockImplementation(() => card.resolve(undefined));

            const answer = surface.approveTool(makeSkill(), call);
            await flush();
            run.cancel();

            expect(await answer).toBe('deny');
            expect(window.showWarningMessage).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // progress
    // -----------------------------------------------------------------------

    describe('progress', () => {
        it('shows a cancellable notification, reports steps, and cancels the run on Cancel', async () => {
            const report = vi.fn();
            const progressCancel = new FakeCancellation();
            let task: Promise<unknown> | undefined;
            window.withProgress.mockImplementation((_options: unknown, fn: (p: unknown, t: CancellationToken) => Promise<unknown>) => {
                task = fn({ report }, progressCancel.token);
                return task;
            });

            const hooks = startRun();
            expect(window.withProgress.mock.calls[0][0]).toMatchObject({
                location: vscode.ProgressLocation.Notification,
                cancellable: true,
                title: 'Writer',
            });

            hooks.onStepStart?.('draft', 0, 2);
            expect(report).toHaveBeenCalledWith({ message: 'Write the draft (1 of 2)' });

            hooks.onModelFallback?.('draft', 'gpt-x', 'gpt-y');
            expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('gpt-y'));
            expect(window.showWarningMessage.mock.calls[0]).toHaveLength(1); // non-modal, no buttons

            progressCancel.cancel();
            expect(cancelRun).toHaveBeenCalledTimes(1);

            let settled = false;
            void task!.then(() => { settled = true; });
            hooks.dispose();
            hooks.dispose(); // idempotent
            await flush();
            expect(settled).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // showResult
    // -----------------------------------------------------------------------

    describe('showResult', () => {
        it('showResult opens an untitled document when the skill has no output.to and no panel', async () => {
            panels.getPanel.mockReturnValue(undefined);

            await surface.showResult(makeSkill(), result(), { kind: 'none' });

            expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({ content: '# Done\n\nAll good.', language: 'markdown' });
            expect(window.showTextDocument).toHaveBeenCalledWith(doc, expect.anything());
            expect(panels.showCard).not.toHaveBeenCalled();
        });

        it('shows a result card without waiting for a click; Copy copies the summary', async () => {
            panels.getPanel.mockReturnValue({});
            const click = deferred<string | undefined>();
            panels.showCard.mockReturnValue(click.promise);

            await surface.showResult(makeSkill(), result(), { kind: 'none' }); // resolves with the card still open

            const card = panels.showCard.mock.calls[0][1] as GraphCard;
            expect(card).toMatchObject({
                kind: 'result',
                actions: [
                    { id: 'open', label: 'Open as document', primary: true },
                    { id: 'copy', label: 'Copy' },
                ],
            });
            expect(card.html).toContain('All good.');
            expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();

            click.resolve('copy');
            await flush();
            expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('# Done\n\nAll good.');
            expect(panels.clearCard).toHaveBeenCalledWith('writer', card.cardId);
        });

        it('reports a delivered output with the sink description', async () => {
            await surface.showResult(makeSkill(), result(), { kind: 'delivered', sink: { kind: 'newDocument' } });
            expect(window.showInformationMessage).toHaveBeenCalledWith('Writer: output opened in a new document.');

            await surface.showResult(makeSkill(), result(), { kind: 'delivered', sink: { kind: 'replaceSelection' }, fellBack: true });
            expect(window.showInformationMessage.mock.calls[1][0]).toContain('opened in a new tab');
        });

        it('presents a failed skill as a failure, not a success', async () => {
            await surface.showResult(makeSkill(), result({ success: false, error: 'it broke' }), { kind: 'none' });

            expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('it broke'), 'Show details');
            expect(window.showInformationMessage).not.toHaveBeenCalled();
            expect(panels.showCard).not.toHaveBeenCalled();
        });

        it('an undelivered output is an error and the summary opens in an untitled document', async () => {
            await surface.showResult(makeSkill({ output: { summary: 's', to: 'nowhere' } }), result(), { kind: 'unknownSink', to: 'nowhere' });

            expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('nowhere'));
            expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({ content: '# Done\n\nAll good.', language: 'markdown' });

            await surface.showResult(makeSkill({ output: { summary: 's', to: 'diff' } }), result(), { kind: 'failed', message: 'disk full' });
            expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('disk full'));
            expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(2);
        });
    });

    // -----------------------------------------------------------------------
    // problems & warnings
    // -----------------------------------------------------------------------

    describe('problems and warnings', () => {
        it('showProblems offers Show details, which writes the lines to the output channel', async () => {
            window.showErrorMessage.mockResolvedValue('Show details' as never);

            surface.showProblems(makeSkill(), "Skill 'Writer' can't run", ['missing tool', 'another']);
            await flush();

            expect(window.showErrorMessage).toHaveBeenCalledWith("Skill 'Writer' can't run", 'Show details');
            const written = output.appendLine.mock.calls.map(c => c[0]).join('\n');
            expect(written).toContain('missing tool');
            expect(written).toContain('another');
            expect(output.show).toHaveBeenCalled();
        });

        it('showWarnings is a non-blocking warning with details', async () => {
            window.showWarningMessage.mockResolvedValue('Show details' as never);

            surface.showWarnings(makeSkill(), ['optional tool missing — install it']);
            await flush();

            expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('optional tool missing'), 'Show details');
            expect(output.appendLine.mock.calls.map(c => c[0]).join('\n')).toContain('install it');
        });

        it('confirmReplaceRun asks before cancelling the running skill', async () => {
            window.showWarningMessage.mockResolvedValue('Cancel and run' as never);
            expect(await surface.confirmReplaceRun(makeSkill(), makeSkill({ name: 'Other' }))).toBe(true);
            expect(window.showWarningMessage.mock.calls[0][1]).toMatchObject({ modal: true });

            window.showWarningMessage.mockResolvedValue(undefined);
            expect(await surface.confirmReplaceRun(makeSkill(), makeSkill({ name: 'Other' }))).toBe(false);
        });
    });
});
