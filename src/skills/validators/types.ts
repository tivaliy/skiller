/**
 * Validation Types
 *
 * Core type definitions for the multi-phase validation engine.
 * Provides rich error reporting with locations, suggestions, and categories.
 */

/**
 * Validation phases executed in order.
 *
 * Note: Raw YAML structure validation (unknown keys, types, required fields)
 * is handled by Zod in the parser (parseSkillFromContent), not in the
 * validation engine. This ensures fail-fast behavior at parse time.
 *
 * - schema: Semantic validation - ID uniqueness, reference validity, file existence
 * - semantic: Logic validation - execution flow, dependencies, reachability
 * - template: Cross-file validation - variables, interpolation, conditions
 * - security: Safety checks - path traversal, injection, character validation
 */
export const VALIDATION_PHASES = [
    'schema',
    'semantic',
    'template',
    'security'
] as const;

export type ValidationPhase = (typeof VALIDATION_PHASES)[number];

/**
 * Severity levels for validation issues
 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/**
 * Categories for grouping validation issues
 */
export type ValidationCategory =
    | 'structure'       // Missing/malformed fields
    | 'type'            // Type mismatches
    | 'reference'       // Invalid references (step IDs, variables)
    | 'flow'            // Execution flow issues
    | 'security'        // Security concerns
    | 'compatibility';  // Forward compatibility warnings

/**
 * Location information for a validation issue
 */
export interface ValidationLocation {
    /** File path (skill.yaml or step file) */
    file?: string;
    /** Field path (e.g., "steps[0].id", "inputs[1].type") */
    field?: string;
    /** Line number if known */
    line?: number;
}

/**
 * Enhanced validation issue with rich context
 */
export interface ValidationIssue {
    /** Unique rule ID that generated this issue (e.g., "schema/step-id") */
    ruleId: string;
    /** Severity level */
    severity: ValidationSeverity;
    /** Which phase detected this */
    phase: ValidationPhase;
    /** Error category for grouping */
    category: ValidationCategory;
    /** Human-readable message */
    message: string;
    /** Location in skill definition (optional) */
    location?: ValidationLocation;
    /** Suggested fix (optional) */
    suggestion?: string;
    /** Related documentation link (optional) */
    docs?: string;
}

/**
 * Validation options for customizing engine behavior
 */
export interface ValidationOptions {
    /** Phases to run (default: all) */
    phases?: ValidationPhase[];
    /** Stop on first error (default: false) */
    failFast?: boolean;
    /** Include info-level issues (default: false) */
    includeInfo?: boolean;
    /** Validate step markdown files - requires file system access (default: true) */
    validateStepFiles?: boolean;
}

/**
 * Final validation result
 */
export interface ValidationResult {
    /** Overall validity (no errors) */
    valid: boolean;
    /** All issues found */
    issues: ValidationIssue[];
    /** Convenience accessor: errors only */
    errors: ValidationIssue[];
    /** Convenience accessor: warnings only */
    warnings: ValidationIssue[];
    /** Phases that were run */
    phasesRun: ValidationPhase[];
    /** Time taken (ms) */
    duration: number;
}

/**
 * Variable scope at a specific step
 * Used by template validators to check variable availability
 */
export interface VariableScope {
    /** Input variables available */
    inputs: Set<string>;
    /** Output variables from previous steps */
    outputs: Set<string>;
    /** Built-in variables always available */
    builtins: Set<string>;
}

/**
 * Result of validating all inputs at runtime
 */
export interface InputValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * Result of validating a single input value
 */
export interface SingleInputValidationResult {
    valid: boolean;
    error?: string;
}
