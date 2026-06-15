import * as vscode from 'vscode';
import {
    commandRegistry,
    handleConfirmationResponse,
    checkPendingConfirmation,
    handleInputResponse,
    checkPendingInputCollection
} from './commands';
import {
    PendingStateManager,
    SkillRegistry,
    createSkillExecutor,
    registerSkillCodeLens,
    enableLiveReload,
    createExecutionState,
    ExecutionStateManager,
    panelManager
} from './skills';
import type { SkillExecutor } from './skills';
import { ToolCache } from './ToolCache';
import { registerTools } from './tools';

const PARTICIPANT_ID = 'tivaliy.skiller';

/** Commands allowed to run even while a skill is awaiting input/confirmation. */
const CONTROL_COMMANDS = new Set(['cancel', 'reset', 'status']);

let toolCache!: ToolCache;
let pendingStateManager!: PendingStateManager;
let skillRegistry!: SkillRegistry;
let skillExecutor!: SkillExecutor;
let executionState!: ExecutionStateManager;
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

/**
 * Result of resolving a chat request model.
 */
interface ResolvedRequestModel {
    model: vscode.LanguageModelChat;
    isAutoMode: boolean;
}

/**
 * Resolve the request model to a usable model for LLM calls.
 * When user selects "Auto", VS Code may pass a placeholder that can't make
 * actual LLM calls; resolve it to a real model while preserving auto mode.
 */
async function resolveRequestModel(requestModel: vscode.LanguageModelChat): Promise<ResolvedRequestModel> {
    const isAutoMode = requestModel.id?.toLowerCase().includes('auto') ?? false;

    if (!isAutoMode) {
        return { model: requestModel, isAutoMode: false };
    }

    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length > 0) {
        console.log(`[Auto mode] Using copilot model: ${models[0].id}`);
        return { model: models[0], isAutoMode: true };
    }

    const anyModels = await vscode.lm.selectChatModels();
    if (anyModels.length > 0) {
        console.log(`[Auto mode] Using fallback model: ${anyModels[0].id}`);
        return { model: anyModels[0], isAutoMode: true };
    }

    throw new Error(
        'No language models available. Please ensure a language model provider (e.g. GitHub Copilot) is installed and signed in.'
    );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Skiller activated');

    extensionUri = context.extensionUri;

    toolCache = new ToolCache(() => vscode.lm.tools);
    toolCache.refresh();

    pendingStateManager = new PendingStateManager();

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    skillRegistry = new SkillRegistry(context.extensionPath, workspacePath);
    await skillRegistry.refresh();

    skillExecutor = createSkillExecutor();
    executionState = createExecutionState();

    context.subscriptions.push({
        dispose: panelManager.connectExecutionState(executionState)
    });

    registerTools(context);
    registerSkillCodeLens(context);
    context.subscriptions.push(enableLiveReload());

    const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handleRequest);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');

    context.subscriptions.push(participant);
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
        extensionUri
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
