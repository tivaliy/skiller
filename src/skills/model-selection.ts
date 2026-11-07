/**
 * Model selection for a run: resolveNativeModel is the native runner's fallback
 * chain (spec §4.5).
 */

import type * as vscode from 'vscode';

const NO_MODELS_MESSAGE =
    'No language models available. Please ensure a language model provider (e.g. GitHub Copilot) is installed and signed in.';

export type SelectChatModels = (selector?: vscode.LanguageModelChatSelector) => Thenable<vscode.LanguageModelChat[]>;

/** What the native runner needs to choose its fallback model. */
export interface NativeModelDeps {
    select: SelectChatModels;
    /** The `skiller.model.default` setting ('' / undefined when unset). */
    settingId(): string | undefined;
    /** The model the user picked on a previous run. */
    rememberedId(): string | undefined;
    remember(id: string): Thenable<void>;
    /** Ask the user to choose; undefined when dismissed. `token` (the run's) dismisses the pick. */
    pick(models: vscode.LanguageModelChat[], token?: vscode.CancellationToken): Promise<vscode.LanguageModelChat | undefined>;
}

/**
 * Choose the run's fallback model: setting -> remembered pick -> ask (and remember).
 * Step and skill models still take precedence inside the model resolver.
 *
 * Resolves undefined when the user dismisses the pick (Escape cancels the run);
 * throws when no model is available at all.
 */
export async function resolveNativeModel(
    deps: NativeModelDeps,
    token?: vscode.CancellationToken
): Promise<vscode.LanguageModelChat | undefined> {
    const models = await deps.select();
    if (models.length === 0) {
        throw new Error(NO_MODELS_MESSAGE);
    }

    for (const id of [deps.settingId(), deps.rememberedId()]) {
        const match = id ? models.find((m) => m.id === id) : undefined;
        if (match) {
            return match;
        }
    }

    const picked = await deps.pick(models, token);
    if (!picked) {
        return undefined;
    }
    await deps.remember(picked.id);
    return picked;
}
