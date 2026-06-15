/**
 * Validators Module
 *
 * Multi-phase validation engine for skill definitions.
 *
 * Provides:
 * - Design-time validation (schema, semantic, template, security)
 * - Runtime input validation
 * - Rich error reporting with suggestions
 *
 * @example
 * ```typescript
 * import { validateSkill, formatValidationResult } from './validators';
 *
 * const result = validateSkill(skill);
 * if (!result.valid) {
 *   console.log(formatValidationResult(skill.id, result));
 * }
 * ```
 */

// ============================================================================
// Core Types
// ============================================================================

export type {
    ValidationPhase,
    ValidationSeverity,
    ValidationCategory,
    ValidationLocation,
    ValidationIssue,
    ValidationOptions,
    ValidationResult,
    VariableScope,
    InputValidationResult,
    SingleInputValidationResult
} from './types';

export { VALIDATION_PHASES } from './types';

// ============================================================================
// Engine & Infrastructure
// ============================================================================

export { ValidationEngine, BaseValidator } from './engine';
export type { Validator } from './engine';
export { ValidationContext } from './context';

// ============================================================================
// Factory & Convenience Functions
// ============================================================================

export {
    createValidationEngine,
    getValidationEngine,
    validateSkill,
    formatValidationResult
} from './factory';

// ============================================================================
// Validators by Phase
// ============================================================================

export {
    // All validators
    allValidators,

    // Schema validators (semantic checks - Zod handles structure in parser)
    schemaValidators,
    StepIdValidator,
    InputDefinitionValidator,
    ToolConfigurationValidator,
    ModelConfigurationValidator,
    ConfirmationOptionsValidator,
    OutputVariablesValidator,
    StepFilesValidator,

    // Semantic validators
    semanticValidators,
    CircularReferencesValidator,
    RequiresOrderingValidator,
    UnreachableStepsValidator,
    ConfirmationPathsValidator,
    ExecutionFlowValidator,

    // Template validators
    templateValidators,
    VariableExistenceValidator,
    OutputOrderingValidator,
    ConditionSyntaxValidator,
    ParamsInterpolationValidator,

    // Security validators
    securityValidators,
    PathTraversalValidator,
    IdCharactersValidator,
    InputConstraintsValidator
} from './rules';

// ============================================================================
// Input Validation (Runtime)
// ============================================================================

export {
    validateInputs,
    validateSingleInput,
    applyDefaults,
    parseConfirmationResponse,
    parseBoolean
} from './input-validator';
