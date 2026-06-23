/**
 * Command Layer Types
 *
 * Defines interfaces for the command system following SOLID principles.
 */

import * as vscode from 'vscode';
import { ToolCache } from '../ToolCache';
import { PendingStateManager, LaunchContextStore, SkillRegistry, SkillExecutor, ExecutionStateManager } from '../skills';

/**
 * Context passed to command handlers
 */
export interface CommandContext {
    request: vscode.ChatRequest;
    chatContext: vscode.ChatContext;
    stream: vscode.ChatResponseStream;
    token: vscode.CancellationToken;
    model: vscode.LanguageModelChat;
    /**
     * Whether user selected "Auto" in the model dropdown.
     * When true, skills control model selection (respects step.model and models.default).
     * When false, user's dropdown choice overrides all skill model configuration.
     */
    isAutoMode: boolean;
    toolCache: ToolCache;
    pendingStateManager: PendingStateManager;
    skillRegistry: SkillRegistry;
    skillExecutor: SkillExecutor;
    executionState: ExecutionStateManager;
    /** Extension URI for resolving bundled assets */
    extensionUri: vscode.Uri;
    /** Trigger-time editor snapshot store (present when launched from the editor). */
    launchContextStore?: LaunchContextStore;
}

/**
 * Result returned by command handlers
 */
export interface CommandResult {
    handled: boolean;
    metadata?: Record<string, unknown>;
}

/**
 * Command handler function signature
 */
export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult>;

/**
 * Command definition
 */
export interface Command {
    name: string;
    description: string;
    handler: CommandHandler;
}
