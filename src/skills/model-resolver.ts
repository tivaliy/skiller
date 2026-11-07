/**
 * Model Resolver
 *
 * Resolves model specifications to VS Code LanguageModelChat objects.
 * Handles alias resolution and fallback behavior. The skill controls model
 * selection: step model, then the skill's default, then the run's model.
 */

import * as vscode from 'vscode';
import type {ModelAliases, ModelSource, ResolvedModel} from './types';

/**
 * Interface for resolving models
 *
 * Abstraction allows for testing without VS Code dependencies.
 */
export interface ModelResolver {
    /**
     * Resolve model for a skill step
     *
     * Resolution priority:
     * 1. Resolve step model spec (alias or direct ID)
     * 2. Fall back to skill default
     * 3. Fall back to the run's model
     * A requested model that isn't installed also falls back to the run's model.
     *
     * @param stepModelSpec - Model specification from step definition (alias or ID)
     * @param skillAliases - Alias mapping from skill's models.aliases
     * @param skillDefault - Default model from skill's models.default
     * @param runModel - The run's fallback model (see resolveNativeModel)
     * @returns Resolved model with metadata
     */
    resolve(
        stepModelSpec: string | undefined,
        skillAliases: ModelAliases | undefined,
        skillDefault: string | undefined,
        runModel: vscode.LanguageModelChat
    ): Promise<ResolvedModel>;

    /**
     * Extract display name from model ID
     *
     * Removes date suffixes for cleaner display:
     * - 'claude-opus-4-5-20251101' → 'claude-opus-4-5'
     * - 'gpt-4o' → 'gpt-4o'
     *
     * @param modelId - The model ID to process
     * @returns Clean display name
     */
    extractDisplayName(modelId: string): string;
}

/**
 * Default implementation using VS Code's language model API
 *
 * Caches the model list per instance to avoid repeated API calls
 * when resolving models for multiple steps in a skill execution.
 */
export class VSCodeModelResolver implements ModelResolver {
    /** Cached model list (fetched once per execution) */
    private cachedModels: vscode.LanguageModelChat[] | null = null;

    async resolve(
        stepModelSpec: string | undefined,
        skillAliases: ModelAliases | undefined,
        skillDefault: string | undefined,
        runModel: vscode.LanguageModelChat
    ): Promise<ResolvedModel> {
        // Resolve alias: aliases[spec] ?? spec
        const resolvedSpec = stepModelSpec
            ? (skillAliases?.[stepModelSpec] ?? stepModelSpec)
            : undefined;

        // Determine target model ID (step spec or skill default)
        const targetModelId = resolvedSpec ?? skillDefault;

        if (targetModelId) {
            // Try to find the specified model
            const foundModel = await this.findModelById(targetModelId);

            if (foundModel) {
                const source: ModelSource = resolvedSpec ? 'skill-step' : 'skill-default';
                return {
                    model: foundModel,
                    displayName: this.extractDisplayName(foundModel.id),
                    source,
                    usedFallback: false
                };
            }

            // Model not found → fallback with warning
            return {
                model: runModel,
                displayName: this.extractDisplayName(runModel.id),
                source: resolvedSpec ? 'skill-step' : 'skill-default',
                usedFallback: true,
                requestedModel: targetModelId
            };
        }

        // No model configuration → use the run's model
        return {
            model: runModel,
            displayName: this.extractDisplayName(runModel.id),
            source: 'auto',
            usedFallback: false
        };
    }

    /**
     * Get models with caching
     *
     * Fetches the model list once and caches it for subsequent calls.
     * This improves performance for skills with many steps.
     */
    private async getModels(): Promise<vscode.LanguageModelChat[]> {
        if (this.cachedModels === null) {
            this.cachedModels = await vscode.lm.selectChatModels();
        }
        return this.cachedModels;
    }

    /**
     * Find a model by ID (exact match or versioned prefix match)
     *
     * Match strategy (in order):
     * 1. Exact match: 'gpt-4o' === 'gpt-4o'
     * 2. Versioned prefix: 'gpt-4o' matches 'gpt-4o-2024-05-13'
     *    (only if suffix is a date pattern like -YYYY-MM-DD or -YYYYMMDD)
     *
     * This prevents loose matches like 'gpt' matching 'gpt-4o'.
     */
    private async findModelById(modelId: string): Promise<vscode.LanguageModelChat | undefined> {
        const models = await this.getModels();

        // First try exact match
        const exactMatch = models.find(m => m.id === modelId);
        if (exactMatch) {
            return exactMatch;
        }

        // Then try versioned prefix match (for date-suffixed model names)
        // e.g., 'gpt-4o' should match 'gpt-4o-2024-05-13'
        // but NOT 'gpt' matching 'gpt-4o' (too loose)
        // Only match if the ENTIRE suffix is a date pattern
        return models.find(m => {
            if (!m.id.startsWith(modelId + '-')) {
                return false;
            }
            const suffix = m.id.slice(modelId.length);
            // Match only date-like suffixes: -YYYY-MM-DD or -YYYYMMDD
            return /^-\d{4}-\d{2}-\d{2}$/.test(suffix) || /^-\d{8}$/.test(suffix);
        });
    }

    /**
     * Extract a human-readable display name from model ID
     *
     * Examples:
     * - 'gpt-4o-2024-05-13' → 'gpt-4o'
     * - 'claude-opus-4-5-20251101' → 'claude-opus-4-5'
     * - 'gpt-4o-mini' → 'gpt-4o-mini'
     */
    extractDisplayName(modelId: string): string {
        // Remove date suffixes like -2024-05-13 or -20251101
        return modelId.replace(/-\d{4}-\d{2}-\d{2}$/, '')
          .replace(/-\d{8}$/, '');
    }
}

/**
 * Create the default model resolver
 */
export function createModelResolver(): ModelResolver {
    return new VSCodeModelResolver();
}
