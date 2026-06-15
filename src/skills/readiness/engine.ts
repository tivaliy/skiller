/**
 * Readiness Engine
 *
 * Orchestrates execution of pre-flight checks before skill execution.
 * Similar pattern to ValidationEngine, but for runtime environment checks.
 *
 * Architecture:
 * - Checks are registered in order
 * - All checks run (no fail-fast by default)
 * - Results are aggregated into ExecutionReadiness
 */

import type { Skill } from '../types';
import type {
    ReadinessCheck,
    ReadinessContext,
    ReadinessIssue,
    ExecutionReadiness
} from './types';

/**
 * Engine for running pre-flight readiness checks
 *
 * @example
 * ```typescript
 * const engine = new ReadinessEngine();
 * engine.register(new ToolAvailabilityCheck(toolResolver));
 *
 * const result = engine.checkReadiness(skill, context);
 * if (!result.canRun) {
 *     console.log('Cannot run:', result.errors);
 * }
 * ```
 */
export class ReadinessEngine {
    private readonly checks: ReadinessCheck[] = [];

    /**
     * Register a readiness check
     */
    register(check: ReadinessCheck): this {
        this.checks.push(check);
        return this;
    }

    /**
     * Register multiple checks
     */
    registerAll(checks: ReadinessCheck[]): this {
        for (const check of checks) {
            this.register(check);
        }
        return this;
    }

    /**
     * Run all registered checks and aggregate results
     */
    checkReadiness(skill: Skill, context: ReadinessContext): ExecutionReadiness {
        const startTime = Date.now();
        const allIssues: ReadinessIssue[] = [];

        // Run each check
        for (const check of this.checks) {
            try {
                const result = check.check(skill, context);
                allIssues.push(...result.issues);
            } catch (error) {
                // Check threw an exception - add as error
                allIssues.push({
                    checkId: check.id,
                    severity: 'error',
                    message: `Check '${check.name}' crashed: ${error instanceof Error ? error.message : String(error)}`
                });
            }
        }

        // Separate errors and warnings
        const errors = allIssues.filter(i => i.severity === 'error');
        const warnings = allIssues.filter(i => i.severity === 'warning');

        return {
            canRun: errors.length === 0,
            issues: allIssues,
            errors,
            warnings,
            duration: Date.now() - startTime
        };
    }

    /**
     * Get count of registered checks
     */
    getCheckCount(): number {
        return this.checks.length;
    }
}
