/**
 * Execution Readiness Module
 *
 * Pre-flight check system for validating runtime environment before skill execution.
 *
 * This module is distinct from static validation (validators/):
 * - Static validation: "Is this skill.yaml well-formed?" (design-time)
 * - Execution readiness: "Can this skill run RIGHT NOW?" (runtime)
 */

// ============================================================================
// Core Types
// ============================================================================

export type {
    ReadinessSeverity,
    ReadinessIssue,
    ReadinessCheckResult,
    ExecutionReadiness,
    ReadinessContext,
    ReadinessCheck,
    ToolAvailabilityResult
} from './types';

// ============================================================================
// Engine
// ============================================================================

export { ReadinessEngine } from './engine';

// ============================================================================
// Checks
// ============================================================================

export { ToolAvailabilityCheck } from './checks';

// ============================================================================
// Factory & Convenience Functions
// ============================================================================

export {
    createReadinessEngine,
    getReadinessEngine,
    resetReadinessEngine,
    checkReadiness,
    formatReadinessResult
} from './factory';
