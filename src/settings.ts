/**
 * Extension Settings Service
 *
 * Centralized configuration management for the Skiller extension.
 * All settings are read dynamically (no caching) to support hot-reload.
 *
 * ## Design Principles
 *
 * 1. **Single Source of Truth** - All defaults defined here
 * 2. **Type Safety** - Full TypeScript interfaces for all settings
 * 3. **Hot Reload** - Settings read at usage time, not cached at activation
 *
 * ## Usage
 *
 * ```typescript
 * import { getSettings, getSetting } from './settings';
 *
 * // Get all settings (when multiple are needed)
 * const settings = getSettings();
 * console.log(settings.skills.toolInvocationTimeout);
 *
 * // Get single setting (for hot paths)
 * const timeout = getSetting('skills.toolInvocationTimeout');
 * ```
 */

import * as vscode from 'vscode';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Verbose mode options for skill execution output
 */
export type VerboseMode = 'off' | 'rendered' | 'raw';

/** Where a skill launched from the editor enters chat. */
export type RunSurface = 'adaptive' | 'chat';

/**
 * Skills-related settings
 */
export interface SkillsSettings {
    /**
     * Control verbose output during skill execution.
     * - 'off': No streaming output shown (default)
     * - 'rendered': Show prompt (code block) and response (rendered markdown)
     * - 'raw': Show prompt and response as plain text (for debugging)
     */
    verboseMode: VerboseMode;

    /**
     * How a skill launched from the editor (command/menu/code-action) enters chat.
     * - 'adaptive': prefill the @skiller command and wait for you to submit (default)
     * - 'chat': submit immediately and watch it run
     */
    runSurface: RunSurface;

    /**
     * Timeout (ms) for MCP tool invocations within skill steps.
     * Increase for slow MCP servers or complex operations.
     * @default 60000 (1 minute)
     */
    toolInvocationTimeout: number;

    /**
     * Maximum LLM tool-use iterations per step.
     * Prevents runaway agentic loops. Each iteration allows LLM to call tools
     * and analyze results before deciding to continue or stop.
     * @default 10
     */
    maxToolIterations: number;

    /**
     * Allow Skiller's file tools (skiller_createFile / skiller_replaceInFile) to
     * write outside the workspace folder. When false (default), paths that resolve
     * outside the workspace are refused. Enable only if a skill legitimately needs
     * to write to absolute paths beyond the workspace.
     * @default false
     */
    allowOutsideWorkspaceWrites: boolean;
}

/**
 * LLM context and history settings
 */
export interface LLMSettings {
    /**
     * Maximum conversation turns sent to LLM for context.
     * Each "turn" is one user message or one assistant response.
     * 20 turns ≈ 10 complete exchanges.
     *
     * Trade-off: more turns = better context but higher token cost.
     * @default 20
     */
    maxHistoryTurns: number;

    /**
     * Maximum characters per tool response before truncation.
     * Large responses (e.g., list of 100 issues) get truncated.
     * 4000 chars ≈ 1000 tokens.
     * @default 4000
     */
    maxToolResponseLength: number;

    /**
     * Maximum tool responses to include in follow-up context.
     * Used for extracting IDs from previous queries.
     * @default 10
     */
    maxToolResponses: number;
}

/**
 * Complete settings structure
 */
export interface QASettings {
    skills: SkillsSettings;
    llm: LLMSettings;
}

// ============================================================================
// Default Values
// ============================================================================

/**
 * Default values for all settings.
 * These match the defaults specified in package.json.
 */
const DEFAULTS: QASettings = {
    skills: {
        verboseMode: 'off',
        runSurface: 'adaptive',
        toolInvocationTimeout: 60_000,
        maxToolIterations: 10,
        allowOutsideWorkspaceWrites: false,
    },
    llm: {
        maxHistoryTurns: 20,
        maxToolResponseLength: 4000,
        maxToolResponses: 10,
    },
};

// ============================================================================
// Settings Access
// ============================================================================

/**
 * Configuration section name in VS Code settings
 */
const CONFIG_SECTION = 'skiller';

/**
 * Get all settings with current values.
 *
 * Settings are read fresh each time (no caching) to support
 * hot-reload when user changes settings.
 *
 * @returns Complete settings object with all current values
 *
 * @example
 * ```typescript
 * const settings = getSettings();
 * const timeout = settings.skills.toolInvocationTimeout;
 * ```
 */
export function getSettings(): QASettings {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

    return {
        skills: {
            verboseMode: config.get<VerboseMode>('skills.verboseMode', DEFAULTS.skills.verboseMode),
            runSurface: config.get<RunSurface>('skills.runSurface', DEFAULTS.skills.runSurface),
            toolInvocationTimeout: config.get<number>('skills.toolInvocationTimeout', DEFAULTS.skills.toolInvocationTimeout),
            maxToolIterations: config.get<number>('skills.maxToolIterations', DEFAULTS.skills.maxToolIterations),
            allowOutsideWorkspaceWrites: config.get<boolean>('skills.allowOutsideWorkspaceWrites', DEFAULTS.skills.allowOutsideWorkspaceWrites),
        },
        llm: {
            maxHistoryTurns: config.get<number>('llm.maxHistoryTurns', DEFAULTS.llm.maxHistoryTurns),
            maxToolResponseLength: config.get<number>('llm.maxToolResponseLength', DEFAULTS.llm.maxToolResponseLength),
            maxToolResponses: config.get<number>('llm.maxToolResponses', DEFAULTS.llm.maxToolResponses),
        },
    };
}

// ============================================================================
// Individual Setting Access (for hot paths)
// ============================================================================

/**
 * Flat setting paths for getSetting() function.
 * Maps dotted path to actual config path.
 */
type SettingPath =
    | 'skills.verboseMode'
    | 'skills.runSurface'
    | 'skills.toolInvocationTimeout'
    | 'skills.maxToolIterations'
    | 'skills.allowOutsideWorkspaceWrites'
    | 'llm.maxHistoryTurns'
    | 'llm.maxToolResponseLength'
    | 'llm.maxToolResponses';

/**
 * Type mapping for setting paths to their value types
 */
type SettingType<P extends SettingPath> =
    P extends 'skills.verboseMode' ? VerboseMode :
    P extends 'skills.runSurface' ? RunSurface :
    P extends 'skills.toolInvocationTimeout' ? number :
    P extends 'skills.maxToolIterations' ? number :
    P extends 'skills.allowOutsideWorkspaceWrites' ? boolean :
    P extends 'llm.maxHistoryTurns' ? number :
    P extends 'llm.maxToolResponseLength' ? number :
    P extends 'llm.maxToolResponses' ? number :
    never;

/**
 * Default values indexed by path
 */
const DEFAULT_BY_PATH: Record<SettingPath, unknown> = {
    'skills.verboseMode': DEFAULTS.skills.verboseMode,
    'skills.runSurface': DEFAULTS.skills.runSurface,
    'skills.toolInvocationTimeout': DEFAULTS.skills.toolInvocationTimeout,
    'skills.maxToolIterations': DEFAULTS.skills.maxToolIterations,
    'skills.allowOutsideWorkspaceWrites': DEFAULTS.skills.allowOutsideWorkspaceWrites,
    'llm.maxHistoryTurns': DEFAULTS.llm.maxHistoryTurns,
    'llm.maxToolResponseLength': DEFAULTS.llm.maxToolResponseLength,
    'llm.maxToolResponses': DEFAULTS.llm.maxToolResponses,
};

/**
 * Get a single setting value by path.
 *
 * More efficient than getSettings() when only one value is needed,
 * as it avoids constructing the full settings object.
 *
 * @param path - Dotted path to the setting (e.g., 'skills.toolInvocationTimeout')
 * @returns The setting value with correct type
 *
 * @example
 * ```typescript
 * const timeout = getSetting('skills.toolInvocationTimeout'); // number
 * const mode = getSetting('skills.verboseMode'); // VerboseMode
 * ```
 */
export function getSetting<P extends SettingPath>(path: P): SettingType<P> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return config.get(path, DEFAULT_BY_PATH[path]) as SettingType<P>;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get default values (useful for documentation and testing)
 */
export function getDefaults(): Readonly<QASettings> {
    return DEFAULTS;
}

/**
 * Check if a setting has been explicitly configured by the user
 * (as opposed to using the default value)
 */
export function isExplicitlyConfigured(path: SettingPath): boolean {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const inspection = config.inspect(path);

    return !!(
        inspection?.globalValue !== undefined ||
        inspection?.workspaceValue !== undefined ||
        inspection?.workspaceFolderValue !== undefined
    );
}
