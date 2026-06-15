/**
 * Model Resolver
 *
 * Resolves model specifications to VS Code LanguageModelChat objects.
 * Handles alias resolution, Auto mode detection, and fallback behavior.
 *
 * Key semantics:
 * - Auto mode: Skill controls model selection (respects step.model and models.default)
 * - Specific mode: User's dropdown choice overrides all skill configuration
 *
 * Detection: `request.model.id.includes('auto')` reliably identifies Auto mode.
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
     * 1. If not Auto mode → user's selection wins
     * 2. Resolve step model spec (alias or direct ID)
     * 3. Fall back to skill default
     * 4. Fall back to request model (VS Code auto-resolved)
     *
     * @param stepModelSpec - Model specification from step definition (alias or ID)
     * @param skillAliases - Alias mapping from skill's models.aliases
     * @param skillDefault - Default model from skill's models.default
     * @param requestModel - Model from chat request (user's dropdown selection)
     * @param isAutoMode - Whether user has "Auto" selected in dropdown
     * @returns Resolved model with metadata
     */
    resolve(
        stepModelSpec: string | undefined,
        skillAliases: ModelAliases | undefined,
        skillDefault: string | undefined,
        requestModel: vscode.LanguageModelChat,
        isAutoMode: boolean
    ): Promise<ResolvedModel>;

    /**
     * List all available language models
     *
     * Used by /models command for discovery.
     *
     * @returns Array of available chat models
     */
    listModels(): Promise<vscode.LanguageModelChat[]>;

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
        requestModel: vscode.LanguageModelChat,
        isAutoMode: boolean
    ): Promise<ResolvedModel> {
        // User override: specific model selected in dropdown → USER WINS
        if (!isAutoMode) {
            return {
                model: requestModel,
                displayName: this.extractDisplayName(requestModel.id),
                source: 'user-override',
                usedFallback: false
            };
        }

        // Auto mode: skill controls model selection
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
                model: requestModel,
                displayName: this.extractDisplayName(requestModel.id),
                source: resolvedSpec ? 'skill-step' : 'skill-default',
                usedFallback: true,
                requestedModel: targetModelId
            };
        }

        // No model configuration → use VS Code's auto-resolved model
        return {
            model: requestModel,
            displayName: this.extractDisplayName(requestModel.id),
            source: 'auto',
            usedFallback: false
        };
    }

    async listModels(): Promise<vscode.LanguageModelChat[]> {
        return await this.getModels();
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

/**
 * Detect if the chat request is in Auto mode
 *
 * When user selects "Auto" in the model dropdown, VS Code's
 * auto-resolved model ID contains 'auto'. This is a reliable
 * detection method based on VS Code's behavior.
 *
 * @param requestModel - Model from chat request
 * @returns true if Auto mode is detected
 */
export function isAutoMode(requestModel: vscode.LanguageModelChat): boolean {
    return requestModel.id.toLowerCase().includes('auto');
}
