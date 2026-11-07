import * as vscode from 'vscode';
import {
    commandRegistry,
    handleConfirmationResponse,
    checkPendingConfirmation,
    handleInputResponse,
    checkPendingInputCollection
} from './commands';
import { createNativeSurface, finishSkill, registerScaffoldCommands, registerTriggers } from './editor';
import { createWriteSkillDeps } from './scaffold';
import {
    PendingStateManager,
    LaunchContextStore,
    SkillRegistry,
    createSkillExecutor,
    registerSkillCodeLens,
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
import { resolveRequestModel } from './skills';
import { resolveNativeModel } from './skills/model-selection';
import { RunController, ToolApprovalPolicy } from './skills/run';
import { registerTools } from './tools';
import { describeSkillerToolCall } from './tools/approval-text';
import { getSetting } from './settings';

const PARTICIPANT_ID = 'tivaliy.skiller';

/** Commands allowed to run even while a skill is awaiting input/confirmation. */
const CONTROL_COMMANDS = new Set(['cancel', 'reset', 'status']);

/** Workspace-state key: names of tools the user chose to always allow in native runs. */
const ALWAYS_ALLOWED_TOOLS_KEY = 'skiller.toolApprovals.always';
/** Global-state key: the model id picked for native runs when no setting names one. */
const LAST_PICKED_MODEL_KEY = 'skiller.model.lastPicked';

let toolCache!: ToolCache;
let pendingStateManager!: PendingStateManager;
let skillRegistry!: SkillRegistry;
let skillExecutor!: SkillExecutor;
let executionState!: ExecutionStateManager;
let launchContextStore!: LaunchContextStore;
let extensionUri: vscode.Uri;

/**
 * Did THIS conversation initiate the pending interaction?
 *
 * Pending state is process-global (a single slot), but the VS Code chat API
 * exposes no conversation/session id. We therefore confirm ownership via the
 * conversation's own history: the turn that set up the pending interaction
 * carries our result-metadata marker. This prevents a skill paused in one chat
 * from consuming a turn sent in a different chat — which would otherwise resume
 * the wrong skill with the wrong stream/model.
 */
function conversationInitiatedPending(
    history: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>,
    skillId: string,
    marker: 'pendingInput' | 'pendingConfirmation'
): boolean {
    for (let i = history.length - 1; i >= 0; i--) {
        const turn = history[i];
        if (turn instanceof vscode.ChatResponseTurn && turn.participant === PARTICIPANT_ID) {
            const metadata = turn.result?.metadata as Record<string, unknown> | undefined;
            if (metadata && metadata.skillId === skillId && metadata[marker] === true) {
                return true;
            }
        }
    }
    return false;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Skiller activated');

    extensionUri = context.extensionUri;

    toolCache = new ToolCache(() => vscode.lm.tools);
    toolCache.refresh();

    pendingStateManager = new PendingStateManager();

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

    registerTools(context, {
        writeSkill: createWriteSkillDeps(skillRegistry, (r) => finishSkill(r, { skillRegistry, extensionUri: context.extensionUri })),
    });
    registerSkillCodeLens(context);

    const showGraph = (skill: Skill): Promise<void> =>
        showSkillGraph(skill, context.extensionUri, { webview: { preserveFocus: true } }).then(() => undefined);
    const toolApprovals = new ToolApprovalPolicy({
        get: () => context.workspaceState.get<string[]>(ALWAYS_ALLOWED_TOOLS_KEY, []),
        set: names => context.workspaceState.update(ALWAYS_ALLOWED_TOOLS_KEY, names),
    });
    const controller = createRunController(context, toolApprovals, showGraph);

    registerTriggers(context, {
        controller,
        registry: skillRegistry,
        policy: toolApprovals,
        launchStore: launchContextStore,
        showGraph,
        reloadTools: () => toolCache.refresh(),
    });
    registerScaffoldCommands(context, { skillRegistry, extensionUri: context.extensionUri, controller });
    context.subscriptions.push(enableLiveReload());

    const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handleRequest);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');

    context.subscriptions.push(participant);
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
        verboseMode: () => getSetting('skills.verboseMode'),
        resolveModel: () => resolveNativeModel({
            select: selector => vscode.lm.selectChatModels(selector),
            settingId: () => getSetting('model.default') || undefined,
            rememberedId: () => context.globalState.get<string>(LAST_PICKED_MODEL_KEY),
            remember: id => context.globalState.update(LAST_PICKED_MODEL_KEY, id),
            pick: pickModel,
        }),
    });
    return controller;
}

/** Ask which language model native runs should fall back to. */
async function pickModel(models: vscode.LanguageModelChat[]): Promise<vscode.LanguageModelChat | undefined> {
    const items = models.map(model => ({
        label: model.name,
        description: `${model.vendor}/${model.family}/${model.id}`,
        model,
    }));
    const picked = await vscode.window.showQuickPick(items, {
        title: 'Choose a model for Skiller runs',
        ignoreFocusOut: true,
    });
    return picked?.model;
}

async function handleRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    if (context.history.length === 0) {
        if (pendingStateManager.clearAllPendingState()) {
            console.log('[Skiller] Cleared orphaned pending state');
        }
        executionState.resetAll();
    }

    const { model, isAutoMode } = await resolveRequestModel(request.model);

    const commandContext = {
        request,
        chatContext: context,
        stream,
        token,
        model,
        isAutoMode,
        toolCache,
        pendingStateManager,
        skillRegistry,
        skillExecutor,
        executionState,
        extensionUri,
        launchContextStore
    };

    // Control commands (/cancel, /reset, /status) are dispatched BEFORE the
    // pending gate so they always work — even while a skill awaits input or
    // confirmation. Without this, a stuck pending state would block its own escape hatch.
    // This is their SOLE dispatch site: return unconditionally so they aren't
    // dispatched a second time by the generic registry dispatch below.
    if (request.command && CONTROL_COMMANDS.has(request.command)) {
        const controlResult = await commandRegistry.dispatch(request.command, commandContext);
        return { metadata: controlResult?.metadata };
    }

    // Pending skill input collection — only consume turns from the conversation
    // that initiated it (see conversationInitiatedPending). Turns from other
    // chats fall through to normal handling instead of resuming the wrong skill.
    if (pendingStateManager.hasPendingInputCollection()) {
        const skillId = pendingStateManager.getPendingInputCollection()?.skillId;
        if (skillId && conversationInitiatedPending(context.history, skillId, 'pendingInput')) {
            if (request.command) {
                checkPendingInputCollection(stream, pendingStateManager);
                return { metadata: { blocked: true, reason: 'pending_input' } };
            }
            const inputResult = await handleInputResponse(commandContext);
            if (inputResult.handled) {
                return { metadata: inputResult.metadata };
            }
        }
    }

    // Pending skill confirmation — same conversation-ownership guard.
    if (pendingStateManager.hasPendingConfirmation()) {
        const skillId = pendingStateManager.getPendingConfirmation()?.skillId;
        if (skillId && conversationInitiatedPending(context.history, skillId, 'pendingConfirmation')) {
            if (request.command) {
                checkPendingConfirmation(stream, pendingStateManager);
                return { metadata: { blocked: true, reason: 'pending_confirmation' } };
            }
            const confirmResult = await handleConfirmationResponse(commandContext);
            if (confirmResult.handled) {
                return { metadata: confirmResult.metadata };
            }
        }
    }

    // Slash commands (/skills, /skill, /help, /tools, /models, /reload)
    const commandResult = await commandRegistry.dispatch(request.command, commandContext);
    if (commandResult?.handled) {
        return { metadata: commandResult.metadata };
    }

    // Skills-only: no ad-hoc tool routing, no free-form chat. Point the user at skills.
    stream.markdown(
        `I run declarative workflows, not free-form chat.\n\n` +
        `- \`/skills\` — list available workflows\n` +
        `- \`/skill <name>\` — run one\n` +
        `- \`/help\` — what I can do`
    );
    return { metadata: { command: 'skills_only_hint' } };
}

export function deactivate(): void {
    panelManager.disposeAll();
    console.log('Skiller deactivated');
}
