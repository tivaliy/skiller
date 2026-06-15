/**
 * Schema Module
 *
 * Single source of truth for skill.yaml structure and validation.
 *
 * This module provides:
 * - Zod schemas for all skill components
 * - TypeScript types generated from schemas
 * - Constants (INPUT_TYPES, STEP_TYPES, etc.) derived from schemas
 * - KNOWN_*_KEYS sets for typo suggestions
 * - Validation functions for raw YAML
 *
 * @example
 * ```typescript
 * import {
 *   skillSchema,
 *   validateSkillYaml,
 *   INPUT_TYPES,
 *   KNOWN_TOP_LEVEL_KEYS,
 *   type SkillYaml
 * } from './schema';
 *
 * // Validate raw YAML
 * const result = validateSkillYaml(parsedYaml);
 * if (!result.success) {
 *   console.error(result.error.issues);
 * }
 * ```
 */

// ============================================================================
// Master Skill Schema
// ============================================================================

export {
    // Schema
    skillSchema,
    errorStrategySchema,
    outputConfigSchema,

    // Constants
    ERROR_STRATEGIES,
    INPUT_TYPES,
    STEP_TYPES,
    TOOL_MODES,
    CONFIRMATION_ACTIONS,

    // Known keys (derived from schemas)
    KNOWN_TOP_LEVEL_KEYS,
    KNOWN_OUTPUT_KEYS,

    // Validation functions
    validateSkillYaml,
    parseSkillYaml,

    // Types
    type RawSkillYaml,
    type SkillYaml,
    type ErrorStrategy
} from './skill.schema';

// ============================================================================
// Input Schema
// ============================================================================

export {
    // Schema
    inputDefinitionSchema,
    inputTypeSchema,

    // Known keys
    KNOWN_INPUT_KEYS,

    // Types
    type RawInputDefinition,
    type InputDefinition,
    type InputType
} from './input.schema';

// ============================================================================
// Step Schema
// ============================================================================

export {
    // Schemas
    stepDefinitionSchema,
    stepTypeSchema,
    toolModeSchema,
    confirmationActionSchema,
    confirmationOptionSchema,

    // Known keys
    KNOWN_STEP_KEYS,
    KNOWN_OPTION_KEYS,

    // Types
    type RawStepDefinition,
    type StepDefinition,
    type StepType,
    type ToolMode,
    type ConfirmationAction,
    type ConfirmationOption
} from './step.schema';

// ============================================================================
// Tools Schema
// ============================================================================

export {
    // Schema
    toolsConfigSchema,

    // Known keys
    KNOWN_TOOLS_KEYS,

    // Types
    type RawToolsConfig,
    type ToolsConfig
} from './tools.schema';

// ============================================================================
// Models Schema
// ============================================================================

export {
    // Schema
    modelsConfigSchema,

    // Known keys
    KNOWN_MODELS_KEYS,

    // Types
    type RawModelsConfig,
    type ModelsConfig
} from './models.schema';
