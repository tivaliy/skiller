import * as vscode from 'vscode';
import { createNativeSurface, createSkillerStatusBar, finishSkill, registerScaffoldCommands, registerTriggers, showMigrationNoticeOnce } from './editor';
import { createWriteSkillDeps } from './scaffold';
import {
    LaunchContextStore,
    SkillRegistry,
    createSkillExecutor,
    registerSkillCodeLens,
    outputNeedsTarget,
    captureDeliveryTarget,
    enableLiveReload,
    createExecutionState,
    ExecutionStateManager,
    panelManager,
    showSkillGraph,
    StepInspectionDocumentProvider,
    STEP_INSPECTION_SCHEME
} from './skills';
import type { Skill, SkillExecutor } from './skills';
import { ToolCache } from './ToolCache';
import { resolveNativeModel } from './skills/model-selection';
import { RunController, ToolApprovalPolicy } from './skills/run';
import { registerTools } from './tools';
import { describeSkillerToolCall } from './tools/approval-text';
import { getSetting } from './settings';

/** Workspace-state key: names of tools the user chose to always allow in native runs. */
const ALWAYS_ALLOWED_TOOLS_KEY = 'skiller.toolApprovals.always';
/** Global-state key: the model id picked for native runs when no setting names one. */
const LAST_PICKED_MODEL_KEY = 'skiller.model.lastPicked';

let toolCache!: ToolCache;
let skillRegistry!: SkillRegistry;
let skillExecutor!: SkillExecutor;
let executionState!: ExecutionStateManager;
let launchContextStore!: LaunchContextStore;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Skiller activated');

    toolCache = new ToolCache(() => vscode.lm.tools);
    toolCache.refresh();

    launchContextStore = new LaunchContextStore();

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    skillRegistry = new SkillRegistry(context.extensionPath, workspacePath);
    await skillRegistry.refresh();

    skillExecutor = createSkillExecutor();
    executionState = createExecutionState();

    context.subscriptions.push({
        dispose: panelManager.connectExecutionState(executionState)
    });

    // Read-only inspector documents for the graph "Open ↗" affordance: render a
    // step's captured prompt/response on demand from execution state.
    const stepInspectionProvider = new StepInspectionDocumentProvider(executionState);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(STEP_INSPECTION_SCHEME, stepInspectionProvider),
        stepInspectionProvider
    );


    const showGraph = (skill: Skill): Promise<void> =>
        showSkillGraph(skill, context.extensionUri, { webview: { preserveFocus: true } }).then(() => undefined);
    const toolApprovals = new ToolApprovalPolicy({
        get: () => context.workspaceState.get<string[]>(ALWAYS_ALLOWED_TOOLS_KEY, []),
        set: names => context.workspaceState.update(ALWAYS_ALLOWED_TOOLS_KEY, names),
    });
    const controller = createRunController(context, toolApprovals, showGraph);
    context.subscriptions.push(createSkillerStatusBar(controller));

    registerTools(context, {
        writeSkill: createWriteSkillDeps(skillRegistry, (r) => finishSkill(r, { skillRegistry, extensionUri: context.extensionUri }), controller),
        listSkills: { skills: () => skillRegistry.getAll() },
        runSkill: {
            find: id => skillRegistry.getById(id),
            ids: () => skillRegistry.getAll().map(s => s.id),
            run: req => controller.run(req),
            captureTarget: skill => outputNeedsTarget(skill.output?.to)
                ? captureDeliveryTarget({ excludeDir: skill.source.path })
                : undefined,
            newCancellation: () => new vscode.CancellationTokenSource(),
            waitCapMs: 600_000,
        },
    });
    registerSkillCodeLens(context);

    registerTriggers(context, {
        controller,
        registry: skillRegistry,
        policy: toolApprovals,
        launchStore: launchContextStore,
        showGraph,
        reloadTools: () => toolCache.refresh(),
        executionState,
    });
    registerScaffoldCommands(context, { skillRegistry, extensionUri: context.extensionUri, controller });
    context.subscriptions.push(enableLiveReload());

    void showMigrationNoticeOnce(
        context.globalState,
        (msg, ...actions) => vscode.window.showInformationMessage(msg, ...actions),
        (cmd, ...args) => vscode.commands.executeCommand(cmd, ...args),
        {
            version: String(context.extension.packageJSON.version),
            hasOwnSkills: skillRegistry.getAll().some(s => s.source.type !== 'builtin'),
        }
    ).catch(err => console.error('Skiller: migration notice failed', err));
}

/**
 * The native runner: a RunController talking to the user through the native surface.
 * The surface's Cancel button cancels the controller's run, so the surface refers
 * back to the controller lazily.
 */
function createRunController(
    context: vscode.ExtensionContext,
    toolApprovals: ToolApprovalPolicy,
    showGraph: (skill: Skill) => Promise<void>
): RunController {
    const output = vscode.window.createOutputChannel('Skiller');
    context.subscriptions.push(output);

    const controller: RunController = new RunController({
        executor: skillExecutor,
        executionState,
        launchStore: launchContextStore,
        toolApprovals,
        surface: createNativeSurface({
            panels: panelManager,
            showGraph,
            output,
            cancelRun: () => { controller.cancelActive(); },
            describeTool: call => describeSkillerToolCall(call.toolName, call.input),
        }),
        newCancellation: () => new vscode.CancellationTokenSource(),
        availableMcps: () => toolCache.getDiscoveredCategories(),
        resolveModel: (_skill, token) => resolveNativeModel({
            select: selector => vscode.lm.selectChatModels(selector),
            settingId: () => getSetting('model.default') || undefined,
            rememberedId: () => context.globalState.get<string>(LAST_PICKED_MODEL_KEY),
            remember: id => context.globalState.update(LAST_PICKED_MODEL_KEY, id),
            pick: pickModel,
        }, token),
    });
    return controller;
}

/** Ask which language model native runs should fall back to; the run's token dismisses the pick. */
async function pickModel(
    models: vscode.LanguageModelChat[],
    token?: vscode.CancellationToken
): Promise<vscode.LanguageModelChat | undefined> {
    const items = models.map(model => ({
        label: model.name,
        description: `${model.vendor}/${model.family}/${model.id}`,
        model,
    }));
    const picked = await vscode.window.showQuickPick(items, {
        title: 'Choose a model for Skiller runs',
        ignoreFocusOut: true,
    }, token);
    return picked?.model;
}

export function deactivate(): void {
    panelManager.disposeAll();
    console.log('Skiller deactivated');
}
