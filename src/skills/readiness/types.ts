/**
 * Execution Readiness Types
 *
 * Type definitions for the pre-flight check system.
 * Validates runtime environment before skill execution.
 *
 * This is distinct from static validation (validators/):
 * - Static validation: "Is this skill.yaml well-formed?"
 * - Execution readiness: "Can this skill run RIGHT NOW?"
 */

import type { Skill } from '../types';
import type { MissingToolInfo } from '../tool-resolver';

// ============================================================================
// Core Types
// ============================================================================

/**
 * Severity levels for readiness issues
 */
export type ReadinessSeverity = 'error' | 'warning';

/**
 * A single issue found during readiness check
 */
export interface ReadinessIssue {
    /** ID of the check that found this issue (e.g., 'tool-availability') */
    checkId: string;
    /** Issue severity - errors block execution, warnings don't */
    severity: ReadinessSeverity;
    /** Human-readable message */
    message: string;
    /** Suggested fix (optional) */
    suggestion?: string;
}

/**
 * Result from a single readiness check
 */
export interface ReadinessCheckResult {
    /** Whether this check passed (no errors, warnings ok) */
    ready: boolean;
    /** Issues found by this check */
    issues: ReadinessIssue[];
}

/**
 * Aggregated result from all readiness checks
 */
export interface ExecutionReadiness {
    /** Whether the skill can run (no errors) */
    canRun: boolean;
    /** All issues from all checks */
    issues: ReadinessIssue[];
    /** Convenience: errors only */
    errors: ReadinessIssue[];
    /** Convenience: warnings only */
    warnings: ReadinessIssue[];
    /** Time taken (ms) */
    duration: number;
}

// ============================================================================
// Context Types
// ============================================================================

/**
 * Context provided to readiness checks
 *
 * Contains runtime information needed for pre-flight validation.
 * Currently empty but kept for extensibility (future checks may need context).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ReadinessContext {
    // No context needed currently - tool availability check uses ToolResolver directly
    // Future checks (e.g., ModelAvailabilityCheck) may add properties here
}

// ============================================================================
// Check Interface
// ============================================================================

/**
 * Interface for a single readiness check
 *
 * Implement this interface to create new pre-flight checks.
 * Checks are executed in registration order.
 *
 * @example
 * ```typescript
 * class ModelAvailabilityCheck implements ReadinessCheck {
 *     id = 'model-availability';
 *     name = 'Model Availability Check';
 *
 *     check(skill: Skill, context: ReadinessContext): ReadinessCheckResult {
 *         // Check if required models are available
 *     }
 * }
 * ```
 */
export interface ReadinessCheck {
    /** Unique identifier for this check */
    readonly id: string;
    /** Human-readable name */
    readonly name: string;
    /** Run the check and return result */
    check(skill: Skill, context: ReadinessContext): ReadinessCheckResult;
}

// ============================================================================
// Extended Types for Specific Checks
// ============================================================================

/**
 * Extended result for tool availability check
 * Includes detailed information about missing tools
 */
export interface ToolAvailabilityResult extends ReadinessCheckResult {
    /** Detailed info about each missing tool */
    missingTools: MissingToolInfo[];
}
