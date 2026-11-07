/**
 * Editor commands that run skills natively: Run Skill, Show Skills, Cancel Run,
 * Reload Skills, Reset Tool Approvals — and New Skill → Describe, which runs the
 * skill-creator through the same RunController.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import * as vscode from 'vscode';
import type { ExtensionContext } from 'vscode';

// Editor capture reads the live editor; pin it so the test controls what gets stashed.
vi.mock('../../../../src/skills/context/resolver', async (orig) => ({
    ...(await orig<typeof import('../../../../src/skills/context/resolver')>()),
    captureSnapshot: vi.fn(),
}));
vi.mock('../../../../src/skills/output/accessors', async (orig) => ({
    ...(await orig<typeof import('../../../../src/skills/output/accessors')>()),
    captureDeliveryTarget: vi.fn(),
}));

import { captureSnapshot } from '../../../../src/skills/context/resolver';
import { captureDeliveryTarget } from '../../../../src/skills/output/accessors';
import { registerRunCommands } from '../../../../src/editor/run/commands';
import type { RunCommandsDeps } from '../../../../src/editor/run/commands';
import { registerScaffoldCommands } from '../../../../src/editor/scaffold-commands';
import { LaunchContextStore } from '../../../../src/skills/launch-context-store';
import { ToolApprovalPolicy } from '../../../../src/skills/run/tool-approvals';
import type { RunController, RunOutcome, RunRequest } from '../../../../src/skills/run';
import type { SkillRegistry, SkillRefreshResult, ExecutionStateManager } from '../../../../src/skills';
import type { Skill, SkillSource } from '../../../../src/skills/types';
import type { DeliveryTarget } from '../../../../src/skills/output/types';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Handler = (...args: unknown[]) => Promise<unknown>;

const registerCommand = vscode.commands.registerCommand as unknown as Mock;
const executeCommand = vscode.commands.executeCommand as unknown as Mock;
const showQuickPick = vscode.window.showQuickPick as unknown as Mock;
const showInputBox = vscode.window.showInputBox as unknown as Mock;
const showInformationMessage = vscode.window.showInformationMessage as unknown as Mock;
const showErrorMessage = vscode.window.showErrorMessage as unknown as Mock;
const captureSnapshotMock = captureSnapshot as unknown as Mock;
const captureDeliveryTargetMock = captureDeliveryTarget as unknown as Mock;

function makeSkill(id: string, overrides: Partial<Skill> = {}, sourceType: SkillSource['type'] = 'workspace'): Skill {
    return {
        id,
        name: `${id} name`,
        description: `${id} description`,
        version: '1.0.0',
        inputs: [],
        tools: { aliases: {} },
        steps: [{ id: 'one', type: 'llm', message: 'x', output: 'out' }],
        onError: 'continue',
        source: { type: sourceType, path: `/skills/${id}` },
        ...overrides,
    };
}

function fakeRegistry(skills: Skill[]) {
    const byId = new Map(skills.map(s => [s.id, s]));
    const refreshResult: SkillRefreshResult = {
        added: [{ id: 'fresh', source: 'workspace' }],
        removed: ['gone'],
        parseErrorsFixed: [],
        newParseErrors: [],
        beforeCount: skills.length,
        afterCount: skills.length,
    };
    return {
        getById: vi.fn((id: string) => byId.get(id)),
        getAll: vi.fn(() => [...byId.values()]),
        getBySource: vi.fn(() => ({
            builtin: skills.filter(s => s.source.type === 'builtin'),
            user: skills.filter(s => s.source.type === 'user'),
            workspace: skills.filter(s => s.source.type === 'workspace'),
        })),
        getWorkspaceSkillsPath: vi.fn(() => '/ws/.skiller/skills'),
        getUserSkillsPath: vi.fn(() => '/home/.vscode/skiller/skills'),
        refreshWithDiff: vi.fn(async () => refreshResult),
    };
}

function fakeController() {
    return {
        run: vi.fn(async (_req: RunRequest): Promise<RunOutcome> => ({ kind: 'cancelled' })),
        cancelActive: vi.fn(() => true),
        active: undefined,
    };
}

function memoryStore(initial: string[] = []) {
    let names = [...initial];
    return {
        get: () => names,
        set: async (next: string[]) => { names = [...next]; },
    };
}

function fakeContext(): ExtensionContext {
    return { subscriptions: [], extensionPath: '/ext', extensionUri: vscode.Uri.file('/ext') } as unknown as ExtensionContext;
}

function handlerFor(command: string): Handler {
    const call = registerCommand.mock.calls.find(([name]) => name === command);
    if (!call) throw new Error(`command not registered: ${command}`);
    return call[1] as Handler;
}

const TARGET: DeliveryTarget = {
    uri: 'file:///ws/notes.md',
    version: 4,
    selection: { start: { line: 1, character: 0 }, end: { line: 2, character: 3 } },
};

// ---------------------------------------------------------------------------
// registerRunCommands
// ---------------------------------------------------------------------------

describe('registerRunCommands', () => {
    let registry: ReturnType<typeof fakeRegistry>;
    let controller: ReturnType<typeof fakeController>;
    let store: ReturnType<typeof memoryStore>;
    let launchStore: LaunchContextStore;
    let showGraph: Mock;
    let reloadTools: Mock;
    let executionState: { reset: Mock };
    let context: ExtensionContext;

    const greeter = makeSkill('greeter', {
        inputs: [{ name: 'text', type: 'string', description: 'Text to rewrite', required: true, from: 'selection' }],
        output: { summary: 'done', to: 'editor.replaceSelection' },
    });
    const builtin = makeSkill('summarize', {}, 'builtin');

    beforeEach(() => {
        registerCommand.mockImplementation(() => ({ dispose: vi.fn() }));
        captureSnapshotMock.mockResolvedValue({ selection: 'hello' });
        captureDeliveryTargetMock.mockReturnValue(TARGET);
        registry = fakeRegistry([greeter, builtin]);
        controller = fakeController();
        store = memoryStore(['skiller_createFile']);
        launchStore = new LaunchContextStore();
        showGraph = vi.fn(async () => undefined);
        reloadTools = vi.fn();
        executionState = { reset: vi.fn() };
        context = fakeContext();
        const deps: RunCommandsDeps = {
            controller: controller as unknown as RunController,
            registry: registry as unknown as SkillRegistry,
            policy: new ToolApprovalPolicy(store),
            launchStore,
            showGraph,
            reloadTools,
            executionState: executionState as unknown as ExecutionStateManager,
        };
        registerRunCommands(context, deps);
    });

    it('registers every run command and disposes them with the extension', () => {
        const names = registerCommand.mock.calls.map(([name]) => name);
        expect(names).toEqual(expect.arrayContaining([
            'skiller.runSkill', 'skiller.showSkills', 'skiller.cancelRun', 'skiller.reloadSkills', 'skiller.resetToolApprovals',
        ]));
        expect(context.subscriptions).toHaveLength(names.length);
    });

    it('runSkill with an id runs that skill through the controller', async () => {
        await handlerFor('skiller.runSkill')('greeter');

        expect(showQuickPick).not.toHaveBeenCalled();
        expect(controller.run).toHaveBeenCalledTimes(1);
        expect(controller.run).toHaveBeenCalledWith({ skill: greeter, target: TARGET });
    });

    it('runSkill stashes editor context before running and passes the delivery target with the request', async () => {
        let stashedAtRun: unknown;
        let storedTargetAtRun: unknown;
        controller.run.mockImplementation(async () => {
            stashedAtRun = launchStore.take('greeter');
            storedTargetAtRun = launchStore.takeTarget('greeter');
            return { kind: 'cancelled' as const };
        });

        await handlerFor('skiller.runSkill')('greeter');

        // Only the sources the skill binds are captured.
        expect(captureSnapshotMock).toHaveBeenCalledWith(expect.anything(), new Set(['selection']));
        expect(captureDeliveryTargetMock).toHaveBeenCalledWith({ excludeDir: '/skills/greeter' });
        expect(stashedAtRun).toEqual({ selection: 'hello' });
        // The target travels with the request, never through the shared store.
        expect(controller.run).toHaveBeenCalledWith({ skill: greeter, target: TARGET });
        expect(storedTargetAtRun).toBeUndefined();
    });

    it('runSkill discards the stashed context when the run does not start', async () => {
        controller.run.mockResolvedValue({ kind: 'notStarted', reason: "'greeter name' is still running." });

        await handlerFor('skiller.runSkill')('greeter');

        expect(launchStore.take('greeter')).toBeUndefined();
        expect(launchStore.hasTarget('greeter')).toBe(false);
    });

    it('a declined replace leaves the running skill delivering to its own launch location', async () => {
        const TARGET_B: DeliveryTarget = { ...TARGET, uri: 'file:///ws/other.md', version: 9 };
        let finishFirst!: () => void;
        controller.run
            .mockImplementationOnce(() => new Promise(resolve => {
                finishFirst = () => resolve({ kind: 'cancelled' as const });
            }))
            .mockResolvedValueOnce({ kind: 'notStarted', reason: "'greeter name' is still running." });

        // Run from editor A; it pauses (the first run stays pending).
        const first = handlerFor('skiller.runSkill')('greeter');
        await vi.waitFor(() => expect(controller.run).toHaveBeenCalledTimes(1));
        // Run the same skill from editor B and decline the replace.
        captureDeliveryTargetMock.mockReturnValue(TARGET_B);
        await handlerFor('skiller.runSkill')('greeter');

        const [[firstRequest], [secondRequest]] = controller.run.mock.calls as unknown as Array<[{ target?: DeliveryTarget }]>;
        expect(firstRequest.target).toEqual(TARGET);
        expect(secondRequest.target).toEqual(TARGET_B);
        expect(launchStore.hasTarget('greeter')).toBe(false);

        finishFirst();
        await first;
    });

    it('runSkill does not capture a delivery target for a skill whose output ignores it', async () => {
        await handlerFor('skiller.runSkill')('summarize');

        expect(captureDeliveryTargetMock).not.toHaveBeenCalled();
        expect(launchStore.hasTarget('summarize')).toBe(false);
        expect(controller.run).toHaveBeenCalledWith({ skill: builtin });
    });

    it('runSkill without an id (or with the context-menu Uri) asks which skill to run', async () => {
        showQuickPick.mockImplementation(async (items: Array<{ description?: string }>) =>
            items.find(i => i.description === 'greeter'));

        await handlerFor('skiller.runSkill')(vscode.Uri.file('/ws/notes.md'));

        expect(showQuickPick).toHaveBeenCalledTimes(1);
        expect(controller.run).toHaveBeenCalledWith({ skill: greeter, target: TARGET });
    });

    it('runSkill does nothing when the picker is dismissed', async () => {
        showQuickPick.mockResolvedValue(undefined);

        await handlerFor('skiller.runSkill')();

        expect(controller.run).not.toHaveBeenCalled();
    });

    it('runSkill reports an unknown skill id instead of running', async () => {
        await handlerFor('skiller.runSkill')('nope');

        expect(controller.run).not.toHaveBeenCalled();
        expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('nope'));
    });

    describe('showSkills', () => {
        /** Pick `skillId` in the skill list, then the action whose label matches `action`. */
        function pickSkillThen(skillId: string, action: RegExp | undefined): { actionLabels: () => string[] } {
            let labels: string[] = [];
            showQuickPick
                .mockImplementationOnce(async (items: Array<{ description?: string }>) =>
                    items.find(i => i.description === skillId))
                .mockImplementationOnce(async (items: Array<{ label: string }>) => {
                    labels = items.map(i => i.label);
                    return action ? items.find(i => action.test(i.label)) : undefined;
                });
            return { actionLabels: () => labels };
        }

        it('offers run / show graph / copy for built-ins', async () => {
            const pick = pickSkillThen('summarize', undefined);

            await handlerFor('skiller.showSkills')();

            expect(pick.actionLabels()).toHaveLength(3);
            expect(pick.actionLabels().join('|')).toMatch(/Run.*\|.*Graph.*\|.*Copy/i);
        });

        it('offers no copy for a skill that is not a built-in', async () => {
            const pick = pickSkillThen('greeter', undefined);

            await handlerFor('skiller.showSkills')();

            expect(pick.actionLabels()).toHaveLength(2);
            expect(pick.actionLabels().join('|')).not.toMatch(/Copy/i);
        });

        it('Run runs the skill natively', async () => {
            pickSkillThen('greeter', /Run/);

            await handlerFor('skiller.showSkills')();

            expect(controller.run).toHaveBeenCalledWith({ skill: greeter, target: TARGET });
        });

        it('Show graph opens the skill graph', async () => {
            pickSkillThen('greeter', /Graph/i);

            await handlerFor('skiller.showSkills')();

            expect(showGraph).toHaveBeenCalledWith(greeter);
            expect(controller.run).not.toHaveBeenCalled();
        });

        it('Copy starts the copy flow for that built-in', async () => {
            pickSkillThen('summarize', /Copy/);

            await handlerFor('skiller.showSkills')();

            expect(executeCommand).toHaveBeenCalledWith('skiller.copySkill', 'summarize');
        });
    });

    it('cancelRun cancels the active run', async () => {
        await handlerFor('skiller.cancelRun')();

        expect(controller.cancelActive).toHaveBeenCalledTimes(1);
        expect(showInformationMessage).not.toHaveBeenCalled();
    });

    it('cancelRun says so when nothing is running', async () => {
        controller.cancelActive.mockReturnValue(false);

        await handlerFor('skiller.cancelRun')();

        expect(showInformationMessage).toHaveBeenCalledWith(expect.stringMatching(/no skill is running/i));
    });

    it('resetToolApprovals clears always-allowed tools', async () => {
        await handlerFor('skiller.resetToolApprovals')();

        expect(store.get()).toEqual([]);
        expect(showInformationMessage).toHaveBeenCalledWith(expect.stringMatching(/tool approvals/i));
    });

    it('reloadSkills rescans skills and tools and reports what changed', async () => {
        await handlerFor('skiller.reloadSkills')();

        expect(registry.refreshWithDiff).toHaveBeenCalledTimes(1);
        expect(reloadTools).toHaveBeenCalledTimes(1);
        expect(showInformationMessage).toHaveBeenCalledWith(expect.stringMatching(/1 added.*1 removed/));
    });

    it('reloadSkills clears leftover execution state of skills that disappeared', async () => {
        await handlerFor('skiller.reloadSkills')();

        expect(executionState.reset).toHaveBeenCalledTimes(1);
        expect(executionState.reset).toHaveBeenCalledWith('gone');
    });
});

// ---------------------------------------------------------------------------
// New Skill → Describe
// ---------------------------------------------------------------------------

describe('New Skill → Describe', () => {
    let controller: ReturnType<typeof fakeController>;

    function register(skills: Skill[]): void {
        const registry = fakeRegistry(skills);
        registerScaffoldCommands(fakeContext(), {
            skillRegistry: registry as unknown as SkillRegistry,
            extensionUri: vscode.Uri.file('/ext'),
            controller: controller as unknown as RunController,
        });
    }

    beforeEach(() => {
        registerCommand.mockImplementation(() => ({ dispose: vi.fn() }));
        controller = fakeController();
    });

    it('New Skill → Describe runs skill-creator with the idea as input', async () => {
        const creator = makeSkill('skill-creator', {}, 'builtin');
        register([creator]);
        showInputBox.mockResolvedValue('  summarize my staged diff  ');

        await handlerFor('skiller.newSkill')('describe');

        expect(showInputBox).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Skill — describe it' }));
        expect(controller.run).toHaveBeenCalledWith({ skill: creator, inputs: { idea: 'summarize my staged diff' } });
        expect(executeCommand).not.toHaveBeenCalledWith('workbench.action.chat.open', expect.anything());
    });

    it('does nothing when the idea is dismissed or empty', async () => {
        register([makeSkill('skill-creator', {}, 'builtin')]);
        showInputBox.mockResolvedValue('   ');

        await handlerFor('skiller.newSkill')('describe');

        expect(controller.run).not.toHaveBeenCalled();
    });

    it('reports a missing skill-creator instead of running', async () => {
        register([]);
        showInputBox.mockResolvedValue('an idea');

        await handlerFor('skiller.newSkill')('describe');

        expect(controller.run).not.toHaveBeenCalled();
        expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('skill-creator'));
    });
});
