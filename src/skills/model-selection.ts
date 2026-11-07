/**
 * Model selection for a run.
 *
 * resolveRequestModel turns the model picked in the chat model dropdown into a
 * usable model (resolving the "Auto" placeholder). The native runner extends this
 * module with its own fallback chain (spec §4.5).
 */

import * as vscode from 'vscode';

/** The model a run uses, and whether the user left model choice to the skill ("Auto"). */
export interface ResolvedRunModel {
    model: vscode.LanguageModelChat;
    isAutoMode: boolean;
}

type SelectChatModels = (selector?: vscode.LanguageModelChatSelector) => Thenable<vscode.LanguageModelChat[]>;

/**
 * Resolve the request model to a usable model for LLM calls.
 * When the user selects "Auto", VS Code may pass a placeholder that can't make
 * actual LLM calls; resolve it to a real model while preserving auto mode.
 */
export async function resolveRequestModel(
    requestModel: vscode.LanguageModelChat,
    select: SelectChatModels = (selector) => vscode.lm.selectChatModels(selector)
): Promise<ResolvedRunModel> {
    const isAutoMode = requestModel.id?.toLowerCase().includes('auto') ?? false;

    if (!isAutoMode) {
        return { model: requestModel, isAutoMode: false };
    }

    const models = await select({ vendor: 'copilot' });
    if (models.length > 0) {
        return { model: models[0], isAutoMode: true };
    }

    const anyModels = await select();
    if (anyModels.length > 0) {
        return { model: anyModels[0], isAutoMode: true };
    }

    throw new Error(
        'No language models available. Please ensure a language model provider (e.g. GitHub Copilot) is installed and signed in.'
    );
}
