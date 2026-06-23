/**
 * Skills Type Definitions
 *
 * Centralized type definitions for the pluggable workflow/skills system.
 * Skills are declarative multi-step workflows defined in YAML + Markdown.
 *
 * Constants (INPUT_TYPES, STEP_TYPES, etc.) and their types are re-exported
 * from the schema module to ensure a single source of truth.
 */

import * as vscode from 'vscode';
import type { ExecutionStateManager } from './execution-state';

// ============================================================================
// Re-export constants and types from schema module (single source of truth)
// ============================================================================

// Re-export for external consumers
export {
    INPUT_TYPES,
    STEP_TYPES,
    TOOL_MODES,
    CONFIRMATION_ACTIONS,
    ERROR_STRATEGIES
} from './schema';

// Import types for local use in this file's interfaces
import type {
    InputType,
    StepType,
    ToolMode,
    ConfirmationAction,
    ErrorStrategy
} from './schema';

// Re-export types
export type { InputType, StepType, ToolMode, ConfirmationAction, ErrorStrategy };

/**
 * Verbose mode options for skill execution output
 * - 'off': No streaming output shown
 * - 'rendered': Show prompt (code block) and response (rendered markdown)
 * - 'raw': Show prompt and response as plain text (for debugging)
 */
export const VERBOSE_MODES = ['off', 'rendered', 'raw'] as const;
export type VerboseMode = (typeof VERBOSE_MODES)[number];

/**
 * Input parameter definition for a skill
 */
export interface SkillInput {
    /** Parameter name */
    name: string;
    /** Data type */
    type: InputType;
    /** Human-readable description */
    description: string;
    /** Whether this input is required */
    required: boolean;
    /** Default value if not provided */
    default?: unknown;
    /** Prompt shown in interactive mode */
    prompt?: string;
    /** Validation regex pattern (for strings) */
    pattern?: string;
    /** Allowed values (enum validation) */
    enum?: string[];
    /** Editor-context binding (e.g. 'selection', 'activeFile.path'); resolved at launch. */
    from?: string;
}

/**
 * Tool configuration for a skill
 *
 * Aliases map friendly names to MCP tool names.
 * Use `?` suffix on the tool name to mark it as optional.
 *
 * @example
 * ```yaml
 * tools:
 *   aliases:
 *     get_issue: mcp_mcp-atlassian_jira_get_issue     # Required (default)
 *     create_file: skiller_createFile                   # Required
 *     mkdir: copilot_createDirectory?                  # Optional (? suffix)
 * ```
 */
export interface SkillTools {
    /**
     * Tool aliases: friendly name → MCP tool name
     *
     * Values ending with `?` are optional (warning if missing, doesn't block execution).
     * Values without `?` are required (error if missing, blocks execution).
     */
    aliases: Record<string, string>;
}

/**
 * Parsed tool alias with extracted optionality
 */
export interface ParsedToolAlias {
    /** The alias name (e.g., 'mkdir') */
    alias: string;
    /** The resolved MCP tool name without ? suffix (e.g., 'copilot_createDirectory') */
    toolName: string;
    /** Whether this tool is optional (had ? suffix) */
    optional: boolean;
}

/**
 * Tool reference from step.tools or step.tool
 */
export interface ToolReference {
    /** The name as written in the step (alias or direct tool name) */
    name: string;
    /** The resolved MCP tool name */
    resolvedName: string;
    /** Whether this tool is optional */
    optional: boolean;
    /** Whether the name was resolved via an alias */
    viaAlias: boolean;
}

// ============================================================================
// Model Types
// ============================================================================

/**
 * Alias mapping: friendly name → model ID
 *
 * Enables semantic model references in skills:
 * - `fast: gpt-4o-mini` - cheap model for simple tasks
 * - `smart: gpt-4o` - capable model for complex analysis
 * - `reasoning: o1-preview` - for multi-step reasoning
 *
 * @example
 * ```yaml
 * models:
 *   aliases:
 *     fast: gpt-4o-mini
 *     smart: gpt-4o
 * ```
 */
export type ModelAliases = Record<string, string>;

/**
 * Skill-level model configuration
 *
 * Enables cost optimization and capability matching per skill.
 * Steps can reference aliases or use direct model IDs.
 *
 * @example
 * ```yaml
 * models:
 *   default: gpt-4o
 *   aliases:
 *     fast: gpt-4o-mini
 *     smart: gpt-4o
 * ```
 */
export interface SkillModels {
    /** Default model for steps without explicit model specification */
    default?: string;
    /** Alias mapping: friendly name → model ID */
    aliases?: ModelAliases;
}

/**
 * Source of model selection - explains why a particular model was chosen
 *
 * - 'user-override': User selected specific model in dropdown (not Auto)
 * - 'skill-step': Step has `model: X` and Auto mode enabled
 * - 'skill-default': No step model, using skill's default
 * - 'auto': No configuration, VS Code auto-resolved
 */
export type ModelSource = 'user-override' | 'skill-step' | 'skill-default' | 'auto';

/**
 * Result of model resolution for a step
 *
 * Contains the resolved model and metadata about how it was selected.
 * Used for both execution and UI display (model badge).
 */
export interface ResolvedModel {
    /** The resolved language model to use */
    model: vscode.LanguageModelChat;
    /** Display name for UI (model badge in step header) */
    displayName: string;
    /** How this model was selected */
    source: ModelSource;
    /** Whether fallback was used (requested model unavailable) */
    usedFallback: boolean;
    /** Original model that was requested (if fallback occurred) */
    requestedModel?: string;
}

/**
 * Model information for step display (runtime badge updates)
 *
 * Lightweight version of ResolvedModel for UI updates during execution.
 * Used by execution state and progress hooks to communicate model info.
 */
export interface StepModelInfo {
    /** Display name for the model badge */
    displayName: string;
    /** How the model was selected */
    source: ModelSource;
}

/**
 * Confirmation option (presented to user as numbered choice)
 */
export interface ConfirmationOption {
    /** Display label for this option */
    label: string;
    /** Action to take when selected */
    action: ConfirmationAction;
    /** Target step ID for 'goto' action */
    gotoStep?: string;
}

/**
 * Confirmation response (stored in outputs when user confirms)
 */
export interface ConfirmationResponse {
    /** Selected option label */
    selectedOption: string;
    /** Selected option index (1-based, as shown to user) */
    selectedIndex: number;
    /** Action that was taken */
    action: ConfirmationAction;
    /** Timestamp when user confirmed */
    timestamp: number;
}

/**
 * Step definition within a skill
 */
export interface SkillStep {
    /** Unique step identifier */
    id: string;
    /** Path to step markdown file (relative to skill directory) */
    file?: string;
    /** Step type: 'llm' (default), 'tool', or 'confirmation' */
    type?: StepType;
    /** Step description (from frontmatter or skill.yaml) */
    description?: string;
    /** MCP tools available for LLM steps (agentic tool use) */
    tools?: string[];
    /**
     * Specific MCP tool to invoke for tool steps.
     * Required when type is 'tool'. Used with params for direct invocation.
     */
    tool?: string;
    /**
     * Parameters for tool steps (type: 'tool').
     * Supports {{variable}} interpolation from inputs/outputs.
     * When provided, tool is invoked directly without LLM.
     *
     * @example
     * ```yaml
     * params:
     *   filePath: "{{inputs.filename}}"
     *   content: "{{outputs.previous_step}}"
     * ```
     */
    params?: Record<string, unknown>;
    /**
     * Tool mode for LLM steps with tools:
     * - 'required' (default when tools listed): LLM must call one of the provided tools
     * - 'auto': LLM decides whether to call tools (use for optional tool access)
     *
     * Note: Only applies to type: 'llm' steps. Some models only support single tool in 'required' mode.
     */
    toolMode?: ToolMode;
    /** Output variable name for this step's result */
    output?: string;
    /** Conditional execution expression */
    when?: string;
    /** Step IDs this step depends on (for validation) */
    requires?: string[];
    /** Inline message for confirmation steps (alternative to file) */
    message?: string;
    /** Options for confirmation steps */
    options?: ConfirmationOption[];
    /**
     * Model specification for this step.
     *
     * Can be:
     * - A model alias defined in `models.aliases` (e.g., 'fast', 'smart')
     * - A direct model ID (e.g., 'gpt-4o-mini')
     *
     * If not specified, uses `models.default` or VS Code's auto-resolved model.
     *
     * Note: Only applies when user's dropdown is set to "Auto".
     * When user selects a specific model, their choice takes precedence.
     *
     * @example
     * ```yaml
     * steps:
     *   - id: classify
     *     model: fast    # Use cheap model for classification
     *     file: steps/classify.md
     * ```
     */
    model?: string;
}

/**
 * Output template for skill completion
 */
export interface SkillOutput {
    /** Summary template with {{variable}} interpolation */
    summary: string;
    /** Output sink target (where the rendered summary is delivered); undefined = chat only. */
    to?: string;
}

/**
 * Complete skill definition (parsed from skill.yaml)
 */
export interface Skill {
    /** Skill identifier (directory name) */
    id: string;
    /** Human-readable name */
    name: string;
    /** Skill description */
    description: string;
    /** Semantic version */
    version: string;
    /** Author or team */
    author?: string;
    /** Input parameters */
    inputs: SkillInput[];
    /** Tool requirements */
    tools: SkillTools;
    /** Model configuration for this skill */
    models?: SkillModels;
    /** Execution steps */
    steps: SkillStep[];
    /** Error handling strategy */
    onError: ErrorStrategy;
    /** Output configuration */
    output?: SkillOutput;
    /** Source location */
    source: SkillSource;
}

/**
 * Where a skill was loaded from
 */
export interface SkillSource {
    /** Source type */
    type: 'builtin' | 'user' | 'workspace';
    /** Absolute path to skill directory */
    path: string;
    /** Whether this skill overrides another */
    overrides?: string;
}

// ============================================================================
// Parser Types
// ============================================================================

/**
 * Parsed step content (from markdown file)
 */
export interface ParsedStep {
    /** Step metadata from frontmatter */
    meta: StepMeta;
    /** Prompt content (markdown body) */
    prompt: string;
}

/**
 * Step metadata from frontmatter
 */
export interface StepMeta {
    /** Step ID (should match skill.yaml) */
    id?: string;
    /** Step description */
    description?: string;
    /** Specific tool to invoke (single tool step) */
    tool?: string;
    /** Tools available for LLM to use during step */
    tools?: string[];
    /** Tool mode: 'auto' (default) or 'required' */
    toolMode?: ToolMode;
    /** Required previous steps */
    requires?: string[];
}

/**
 * Error from parsing a skill.yaml file
 */
export interface ParseError {
    /** Skill ID (directory name) */
    skillId: string;
    /** Path to the skill directory */
    path: string;
    /** Error message describing what went wrong */
    error: string;
}

/**
 * Result of parsing a skill - either success or error
 *
 * On success, includes:
 * - skill: The normalized Skill structure
 *
 * Note: Raw YAML validation (structure, types, unknown keys) is handled
 * by Zod during parsing, not in a separate validation phase.
 */
export type ParseSkillResult =
    | { success: true; skill: Skill }
    | { success: false; error: ParseError };

// ============================================================================
// Execution Context Types
// ============================================================================

/**
 * Execution context passed between steps
 */
export interface ExecutionContext {
    /** Original input parameters */
    inputs: Record<string, unknown>;
    /** Accumulated step outputs */
    outputs: Record<string, unknown>;
    /** Current step index */
    currentStep: number;
    /** Total steps count */
    totalSteps: number;
    /** Skill being executed */
    skill: Skill;
    /** Execution start time */
    startTime: number;
    /** Step execution times */
    stepTimes: Record<string, number>;
    /** Available MCP categories */
    availableMcps: string[];
}


/**
 * Result of a single step execution
 */
export interface StepResult {
    /** Step ID */
    stepId: string;
    /** Whether step succeeded */
    success: boolean;
    /** Step output data */
    data?: unknown;
    /** Error message if failed */
    error?: string;
    /** Execution time in ms */
    duration: number;
    /** Whether step was skipped (conditional) */
    skipped?: boolean;
    /** Skip reason */
    skipReason?: string;
    /** Interpolated prompt used for this step (with variables resolved) */
    prompt?: string;
    /** Tool name if single MCP tool step */
    toolName?: string;
    /** Tools used during LLM step (if any) */
    toolsUsed?: string[];
    /** Model ID used for this step (for LLM steps) */
    modelUsed?: string;
}

/**
 * Result of complete skill execution
 */
export interface SkillResult {
    /** Skill ID */
    skillId: string;
    /** Whether skill completed successfully */
    success: boolean;
    /** Individual step results */
    steps: StepResult[];
    /** Final context with all outputs */
    context: ExecutionContext;
    /** Total execution time in ms */
    duration: number;
    /** Error if skill failed */
    error?: string;
    /** Formatted output summary */
    summary?: string;
    /** Pending confirmation info (skill paused waiting for user) */
    pendingConfirmation?: PendingConfirmationInfo;
}

/**
 * Information about a pending confirmation step
 */
export interface PendingConfirmationInfo {
    /** Index of the confirmation step */
    stepIndex: number;
    /** Step ID */
    stepId: string;
    /** Rendered confirmation message */
    message: string;
    /** Available options */
    options: ConfirmationOption[];
}

/**
 * Full pending confirmation state (for resuming execution)
 */
export interface PendingConfirmation {
    /** Skill ID */
    skillId: string;
    /** The skill definition */
    skill: Skill;
    /** Execution context at time of pause */
    context: ExecutionContext;
    /** Index of the confirmation step */
    pendingStepIndex: number;
    /** The confirmation options */
    options: ConfirmationOption[];
    /** Step results collected so far */
    stepResults: StepResult[];
}

/**
 * Pending input collection state (for interactive input prompting)
 */
export interface PendingInputCollection {
    /** Skill ID */
    skillId: string;
    /** The skill definition */
    skill: Skill;
    /** Inputs collected so far */
    collectedInputs: Record<string, unknown>;
    /** Current input being prompted for */
    currentInput: SkillInput;
    /** Remaining inputs to collect */
    remainingInputs: SkillInput[];
}

/**
 * Skill discovery result
 */
export interface DiscoveredSkills {
    /** All available skills (merged, with overrides applied) */
    skills: Map<string, Skill>;
    /** Built-in skills */
    builtin: Skill[];
    /** User-level skills */
    user: Skill[];
    /** Workspace skills */
    workspace: Skill[];
    /** Skills that override others */
    overrides: Array<{ skillId: string; overrides: 'builtin' | 'user' }>;
    /** Skills that failed to parse */
    parseErrors: ParseError[];
}

// ============================================================================
// Execution Types
// ============================================================================

/**
 * Options for skill execution
 */
export interface ExecutionOptions {
    /** Input parameters for the skill */
    inputs: Record<string, unknown>;
    /** VS Code language model for LLM calls */
    model: vscode.LanguageModelChat;
    /**
     * Whether user selected "Auto" in the model dropdown.
     * When true, skills control model selection (respects step.model and models.default).
     * When false, user's dropdown choice overrides all skill model configuration.
     */
    isAutoMode: boolean;
    /** Cancellation token */
    token: vscode.CancellationToken;
    /** Chat stream for progress output */
    stream?: vscode.ChatResponseStream;
    /** Available MCP categories */
    availableMcps: string[];
    /** Tool invocation token for MCP calls */
    toolToken?: vscode.ChatParticipantToolToken;
    /** Verbose output mode for debugging (from settings) */
    verboseMode?: VerboseMode;
    /** Execution state manager for tracking progress (required, inject via DI) */
    executionState: ExecutionStateManager;
}

/**
 * Options for resuming a skill from a specific step
 */
export interface ResumeOptions {
    /** Step index to resume from */
    startFromStep: number;
    /** Existing execution context to continue with */
    existingContext: ExecutionContext;
    /** Step results collected so far */
    existingStepResults: StepResult[];
    /**
     * Output to record before resuming (e.g. a confirmation step's recorded
     * choice). Written by the executor — the single point of context mutation —
     * so callers must not write to `existingContext.outputs` directly.
     */
    recordOutput?: { key: string; value: unknown };
    /**
     * The step whose response triggered this resume (e.g. an answered
     * confirmation). The executor marks it 'completed' when it falls outside the
     * re-run window, so the command layer doesn't poke execution state directly —
     * keeping all resume-time state transitions owned by the executor. (When the
     * step is inside the re-run window — a backward goto — it is reset to 'pending'
     * and re-run instead.)
     */
    completedStepId?: string;
}
