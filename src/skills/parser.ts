/**
 * Skill Parser
 *
 * Parses skill.yaml manifests and step markdown files.
 * Handles YAML parsing and frontmatter extraction.
 *
 * Uses Zod schema for validation:
 * - Validates raw YAML structure before normalization
 * - Rejects unknown keys with typo suggestions
 * - Enforces required fields and type constraints
 *
 * Validation is handled separately by validators/.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
    Skill,
    SkillInput,
    SkillStep,
    SkillTools,
    SkillModels,
    SkillSource,
    ErrorStrategy,
    ERROR_STRATEGIES,
    StepType,
    STEP_TYPES,
    ConfirmationAction,
    CONFIRMATION_ACTIONS,
    ConfirmationOption,
    InputType,
    INPUT_TYPES,
    ToolMode,
    ParsedStep,
    StepMeta,
    ParseSkillResult
} from './types';
import {
    validateSkillYaml,
    KNOWN_TOP_LEVEL_KEYS,
    KNOWN_STEP_KEYS,
    KNOWN_INPUT_KEYS,
    KNOWN_OPTION_KEYS,
    KNOWN_TOOLS_KEYS,
    KNOWN_MODELS_KEYS,
    KNOWN_OUTPUT_KEYS
} from './schema';
import { findSimilarStrings } from './utils';

/**
 * Get the appropriate known keys set based on the Zod error path.
 * This enables context-aware typo suggestions for nested structures.
 */
function getKnownKeysForPath(path: (string | number)[]): Set<string> {
    if (path.length === 0) {
        return KNOWN_TOP_LEVEL_KEYS;
    }

    const firstSegment = path[0];

    // steps[n].* → use step keys
    if (firstSegment === 'steps') {
        // steps[n].options[m].* → use option keys
        if (path.length >= 3 && path[2] === 'options') {
            return KNOWN_OPTION_KEYS;
        }
        return KNOWN_STEP_KEYS;
    }

    // inputs[n].* → use input keys
    if (firstSegment === 'inputs') {
        return KNOWN_INPUT_KEYS;
    }

    // tools.* → use tools keys
    if (firstSegment === 'tools') {
        return KNOWN_TOOLS_KEYS;
    }

    // models.* → use models keys
    if (firstSegment === 'models') {
        return KNOWN_MODELS_KEYS;
    }

    // output.* → use output keys
    if (firstSegment === 'output') {
        return KNOWN_OUTPUT_KEYS;
    }

    // Default to top-level keys
    return KNOWN_TOP_LEVEL_KEYS;
}

// Re-export parser-related types for convenience (co-location)
export type { ParsedStep, StepMeta, ParseError, ParseSkillResult } from './types';

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Raw skill.yaml structure before normalization
 *
 * Required fields (enforced by schema validation):
 * - name: Skill display name
 * - steps: At least one step definition
 */
interface RawSkillYaml {
    id?: string;
    name: string;
    description?: string;
    version?: string;
    author?: string;
    inputs?: RawInput[];  // Array format only
    tools?: RawTools;
    models?: RawModels;
    steps: RawStep[];
    on_error?: string;
    output?: {
        summary?: string;
        to?: string;
    };
}

// ============================================================================
// Known Keys (imported from schema - single source of truth)
// ============================================================================
// KNOWN_TOP_LEVEL_KEYS imported from ./schema for typo suggestions

interface RawModels {
    default?: string;
    aliases?: Record<string, string>;
}

interface RawInput {
    name?: string;  // Used when inputs is an array format
    type?: string;
    description?: string;
    required?: boolean;
    default?: unknown;
    prompt?: string;
    pattern?: string;
    enum?: string[];
    from?: string;
}

interface RawTools {
    aliases?: Record<string, string>;
}

interface RawStep {
    id?: string;
    file?: string;
    description?: string;
    tools?: string[];
    tool?: string;
    /** Parameters for tool steps (direct invocation without LLM) */
    params?: Record<string, unknown>;
    /** Model specification (alias or direct ID) */
    model?: string;
    /** Tool mode: 'auto' (LLM decides) or 'required' (force tool use) */
    tool_mode?: string;
    output?: string;
    when?: string;
    requires?: string[];
    type?: string;
    message?: string;
    options?: Array<{
        label: string;
        action: string;
        goto_step?: string;
    }>;
}

// ============================================================================
// Parsing Functions
// ============================================================================
// Key validation is now handled by Zod schema (validateSkillYaml from ./schema)

/**
 * Parse a skill from YAML content string
 *
 * Uses Zod schema for validation before normalization:
 * - Validates structure, types, and required fields
 * - Rejects unknown keys with typo suggestions
 * - Provides detailed error messages
 *
 * @param content - YAML content string
 * @param skillDir - Directory containing the skill
 * @param source - Skill source metadata
 * @returns ParseSkillResult with skill on success, or error details on failure
 */
export function parseSkillFromContent(content: string, skillDir: string, source: SkillSource): ParseSkillResult {
    const skillId = path.basename(skillDir);

    try {
        // Step 1: Parse YAML to JavaScript object
        const raw = yaml.load(content);

        // Step 2: Validate with Zod schema (strict mode - rejects unknown keys)
        const validationResult = validateSkillYaml(raw);

        if (!validationResult.success) {
            // Format Zod errors with path and context-aware suggestions
            const errors = validationResult.error.issues.map(issue => {
                const pathStr = issue.path.join('.');
                const location = pathStr ? `${pathStr}: ` : '';

                // Add typo suggestions for unrecognized keys
                let suggestion = '';
                if (issue.code === 'unrecognized_keys') {
                    const unknownKeys = issue.keys;
                    const knownKeys = getKnownKeysForPath(issue.path);
                    const suggestions: string[] = [];

                    for (const key of unknownKeys) {
                        const similar = findSimilarStrings(key, knownKeys, 2)[0];
                        if (similar) {
                            suggestions.push(`'${key}' → '${similar}'`);
                        }
                    }

                    if (suggestions.length > 0) {
                        suggestion = ` Did you mean: ${suggestions.join(', ')}?`;
                    } else {
                        // No similar keys found - remind about snake_case convention
                        suggestion = ' Note: skill.yaml uses snake_case keys (e.g., on_error, tool_mode, goto_step).';
                    }
                }

                return `${location}${issue.message}${suggestion}`;
            });

            return {
                success: false,
                error: {
                    skillId,
                    path: skillDir,
                    error: `Invalid skill.yaml:\n  - ${errors.join('\n  - ')}`
                }
            };
        }

        // Step 3: Normalize to internal Skill structure
        // At this point, Zod has validated the structure
        const skill = normalizeSkill(raw as RawSkillYaml, skillDir, source);

        return { success: true, skill };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: {
                skillId,
                path: skillDir,
                error: `Failed to parse skill.yaml: ${errorMessage}`
            }
        };
    }
}

/**
 * Parse a skill from a directory.
 *
 * Uses vscode.workspace.fs for:
 * - Remote SSH compatibility
 * - GitHub Codespaces support
 * - Virtual file system support
 * - Non-blocking I/O
 *
 * @param skillDir - Directory containing skill.yaml
 * @param source - Skill source metadata
 * @returns Promise resolving to parsed skill or error
 */
export async function parseSkill(skillDir: string, source: SkillSource): Promise<ParseSkillResult> {
    const skillId = path.basename(skillDir);
    const skillYamlUri = vscode.Uri.file(path.join(skillDir, 'skill.yaml'));

    try {
        const contentBytes = await vscode.workspace.fs.readFile(skillYamlUri);
        const content = new TextDecoder('utf-8').decode(contentBytes);
        return parseSkillFromContent(content, skillDir, source);
    } catch (error) {
        // FileNotFound or read error - provide appropriate message
        const isNotFound = error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
        const errorMessage = isNotFound
            ? 'skill.yaml not found'
            : `Failed to read skill.yaml: ${error instanceof Error ? error.message : String(error)}`;

        return {
            success: false,
            error: {
                skillId,
                path: skillDir,
                error: errorMessage
            }
        };
    }
}

/**
 * Normalize raw YAML into typed Skill structure
 */
function normalizeSkill(raw: RawSkillYaml, skillDir: string, source: SkillSource): Skill {
    // Use explicit id from YAML if provided, otherwise default to directory name
    const skillId = raw.id || path.basename(skillDir);

    return {
        id: skillId,
        name: raw.name || skillId,
        description: raw.description || '',
        version: raw.version || '1.0.0',
        author: raw.author,
        inputs: normalizeInputs(raw.inputs),
        tools: normalizeTools(raw.tools),
        models: normalizeModels(raw.models),
        steps: normalizeSteps(raw.steps || [], skillDir),
        onError: normalizeErrorStrategy(raw.on_error),
        output: raw.output ? { summary: raw.output.summary || '', to: raw.output.to } : undefined,
        source
    };
}

/**
 * Normalize input parameters (array format only)
 *
 * Format:
 * ```yaml
 * inputs:
 *   - name: feature
 *     type: string
 * ```
 */
function normalizeInputs(raw?: RawInput[]): SkillInput[] {
    if (!raw) return [];

    // Validate array format
    if (!Array.isArray(raw)) {
        console.error('Invalid inputs format: expected array. Use "- name: ..." syntax in skill.yaml');
        return [];
    }

    return raw.map((input, index) => {
        if (!input.name) {
            console.warn(`Input at index ${index} is missing 'name' property`);
        }
        return {
            name: input.name || `unnamed_${index}`,
            type: normalizeInputType(input.type),
            description: input.description || '',
            required: input.required ?? true,
            default: input.default,
            prompt: input.prompt,
            pattern: input.pattern,
            enum: input.enum,
            from: input.from
        };
    });
}

/**
 * Normalize input type string
 */
function normalizeInputType(type?: string): InputType {
    if (!type) return 'string';
    const normalized = type.toLowerCase();
    if ((INPUT_TYPES as readonly string[]).includes(normalized)) {
        return normalized as InputType;
    }
    return 'string'; // Default fallback
}

/**
 * Normalize tool configuration
 *
 * Tools section now only supports aliases. Use `?` suffix on tool names
 * to mark them as optional.
 *
 * @throws Error if unsupported `required` or `optional` arrays are used
 */
function normalizeTools(raw?: RawTools): SkillTools {
    // Check for unsupported fields (may exist in raw YAML but not in typed interface)
    const rawAny = raw as Record<string, unknown> | undefined;
    if (rawAny?.required !== undefined || rawAny?.optional !== undefined) {
        const unsupportedKeys: string[] = [];
        if (rawAny?.required !== undefined) unsupportedKeys.push('required');
        if (rawAny?.optional !== undefined) unsupportedKeys.push('optional');

        throw new Error(
            `tools.${unsupportedKeys.join(' and tools.')} ${unsupportedKeys.length > 1 ? 'are' : 'is'} not supported. ` +
            'Remove these arrays and use the ? suffix on alias values to mark tools as optional. ' +
            'Example: mkdir: copilot_createDirectory?'
        );
    }

    return {
        aliases: raw?.aliases || {}
    };
}

/**
 * Parse a tool alias value to extract the tool name and optionality
 *
 * @param aliasValue - The alias value (e.g., 'copilot_createDirectory?')
 * @returns Object with toolName and optional flag
 *
 * @example
 * parseAliasValue('copilot_mkdir?') // { toolName: 'copilot_mkdir', optional: true }
 * parseAliasValue('skiller_createFile')  // { toolName: 'skiller_createFile', optional: false }
 */
export function parseAliasValue(aliasValue: string): { toolName: string; optional: boolean } {
    if (aliasValue.endsWith('?')) {
        return {
            toolName: aliasValue.slice(0, -1),
            optional: true
        };
    }
    return {
        toolName: aliasValue,
        optional: false
    };
}

/**
 * Normalize model configuration
 *
 * Parses the models section for per-step model selection:
 * ```yaml
 * models:
 *   default: gpt-4o
 *   aliases:
 *     fast: gpt-4o-mini
 *     smart: gpt-4o
 * ```
 */
function normalizeModels(raw?: RawModels): SkillModels | undefined {
    if (!raw) {
        return undefined;
    }

    // Only return if there's actual configuration
    if (!raw.default && !raw.aliases) {
        return undefined;
    }

    return {
        default: raw.default,
        aliases: raw.aliases
    };
}

/**
 * Normalize step definitions
 * Converts YAML snake_case (tool_mode) to TypeScript camelCase (toolMode)
 */
function normalizeSteps(raw: RawStep[], skillDir: string): SkillStep[] {
    return raw.map((step, index) => {
        const id = step.id || `step-${index + 1}`;

        // File is optional for:
        // - Confirmation steps with inline message
        // - Tool steps with params (pure tool invocation)
        // - LLM steps with inline message
        const isConfirmationWithMessage = step.type === 'confirmation' && step.message && !step.file;
        const isToolWithParams = step.type === 'tool' && step.params && !step.file;
        const isLLMWithMessage = step.type === 'llm' && step.message && !step.file;
        const fileOptional = isConfirmationWithMessage || isToolWithParams || isLLMWithMessage;
        const file = fileOptional ? undefined : (step.file || `steps/${String(index + 1).padStart(2, '0')}-${id}.md`);

        return {
            id,
            file,
            type: normalizeStepType(step.type),
            description: step.description,
            tools: step.tools,
            tool: step.tool,
            params: step.params,
            model: step.model,
            toolMode: normalizeToolMode(step.tool_mode),
            output: step.output,
            when: step.when,
            requires: step.requires,
            message: step.message,
            options: normalizeOptions(step.options)
        };
    });
}

/**
 * Normalize step type string to StepType
 *
 * @throws Error if type is provided but not a valid StepType.
 *         For YAML-parsed skills, Zod validates this upstream, so this
 *         primarily catches bugs in programmatically-constructed skills.
 */
function normalizeStepType(type?: string): StepType | undefined {
    if (!type) return undefined;
    const normalized = type.toLowerCase();
    if ((STEP_TYPES as readonly string[]).includes(normalized)) {
        return normalized as StepType;
    }
    // Invalid type value - Zod should catch this for YAML, but throw for programmatic use
    throw new Error(
        `Invalid step type '${type}'. Valid types are: ${STEP_TYPES.join(', ')}`
    );
}

/**
 * Normalize confirmation options
 * Converts YAML snake_case (goto_step) to TypeScript camelCase (gotoStep)
 */
function normalizeOptions(raw?: Array<{ label: string; action: string; goto_step?: string }>): ConfirmationOption[] | undefined {
    if (!raw) return undefined;
    return raw.map(opt => ({
        label: opt.label,
        action: normalizeConfirmationAction(opt.action),
        gotoStep: opt.goto_step
    }));
}

/**
 * Normalize tool mode string
 * Valid values: 'auto', 'required'
 */
function normalizeToolMode(mode?: string): ToolMode | undefined {
    if (!mode) return undefined;
    const normalized = mode.toLowerCase();
    if (normalized === 'auto' || normalized === 'required') {
        return normalized as ToolMode;
    }
    return undefined;
}

/**
 * Normalize confirmation action string
 */
function normalizeConfirmationAction(action: string): ConfirmationAction {
    const normalized = action.toLowerCase();
    if ((CONFIRMATION_ACTIONS as readonly string[]).includes(normalized)) {
        return normalized as ConfirmationAction;
    }
    return 'continue'; // Default fallback
}

/**
 * Normalize error handling strategy
 */
function normalizeErrorStrategy(raw?: string): ErrorStrategy {
    if (!raw) return 'abort';

    const normalized = raw.toLowerCase();
    if ((ERROR_STRATEGIES as readonly string[]).includes(normalized)) {
        return normalized as ErrorStrategy;
    }

    return 'abort'; // Default fallback
}

/**
 * Parse a step markdown file.
 *
 * Uses vscode.workspace.fs for remote/virtual filesystem compatibility.
 *
 * @param stepPath - Absolute path to step markdown file
 * @returns Promise resolving to parsed step or null if not found/unreadable
 */
export async function parseStep(stepPath: string): Promise<ParsedStep | null> {
    const stepUri = vscode.Uri.file(stepPath);

    try {
        const contentBytes = await vscode.workspace.fs.readFile(stepUri);
        const content = new TextDecoder('utf-8').decode(contentBytes);
        return parseStepContent(content);
    } catch {
        // File not found or read error - return null (caller handles missing steps)
        console.error(`Step file not found or unreadable: ${stepPath}`);
        return null;
    }
}

/**
 * Parse step content (frontmatter + body)
 */
export function parseStepContent(content: string): ParsedStep {
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

    if (frontmatterMatch) {
        const [, frontmatter, body] = frontmatterMatch;
        const meta = parseFrontmatter(frontmatter);
        return {
            meta,
            prompt: body.trim()
        };
    }

    // No frontmatter, entire content is the prompt
    return {
        meta: {},
        prompt: content.trim()
    };
}

/**
 * Parse YAML frontmatter into StepMeta
 * Converts YAML snake_case (tool_mode) to TypeScript camelCase (toolMode)
 */
function parseFrontmatter(frontmatter: string): StepMeta {
    try {
        const raw = yaml.load(frontmatter) as Record<string, unknown>;
        return {
            id: raw.id as string | undefined,
            description: raw.description as string | undefined,
            tool: raw.tool as string | undefined,
            tools: raw.tools as string[] | undefined,
            toolMode: normalizeToolMode(raw.tool_mode as string | undefined),
            requires: raw.requires as string[] | undefined
        };
    } catch {
        return {};
    }
}

/**
 * Load all step prompts for a skill.
 *
 * Loads step files in parallel for better performance.
 *
 * @param skill - Skill definition with steps
 * @returns Promise resolving to map of step ID to parsed step content
 */
export async function loadSkillSteps(skill: Skill): Promise<Map<string, ParsedStep>> {
    const steps = new Map<string, ParsedStep>();

    // Collect steps that have files
    const stepsWithFiles = skill.steps.filter(step => step.file);

    // Load all step files in parallel for better performance
    const results = await Promise.all(
        stepsWithFiles.map(async step => {
            const stepPath = path.join(skill.source.path, step.file!);
            const parsed = await parseStep(stepPath);
            return { stepId: step.id, parsed };
        })
    );

    // Collect successful parses
    for (const { stepId, parsed } of results) {
        if (parsed) {
            steps.set(stepId, parsed);
        }
    }

    return steps;
}
