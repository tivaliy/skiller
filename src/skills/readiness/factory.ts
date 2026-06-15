/**
 * Readiness Factory
 *
 * Creates pre-configured readiness engines with all default checks.
 * Provides convenience functions for common readiness checking scenarios.
 */

import type { Skill } from '../types';
import type { ToolResolver } from '../tool-resolver';
import { createToolResolver } from '../tool-resolver';
import type { ReadinessContext, ExecutionReadiness } from './types';
import { ReadinessEngine } from './engine';
import { ToolAvailabilityCheck } from './checks';

/**
 * Create a readiness engine with all default checks registered
 *
 * @param toolResolver - Tool resolver for tool availability check (optional, creates default if not provided)
 */
export function createReadinessEngine(toolResolver?: ToolResolver): ReadinessEngine {
    const resolver = toolResolver ?? createToolResolver();

    const engine = new ReadinessEngine();
    engine.register(new ToolAvailabilityCheck(resolver));

    return engine;
}

// Singleton instance for common use
let defaultEngine: ReadinessEngine | null = null;

/**
 * Get the default readiness engine (singleton)
 *
 * Creates the engine on first call, reuses on subsequent calls.
 * Use createReadinessEngine() if you need a fresh instance or custom configuration.
 */
export function getReadinessEngine(): ReadinessEngine {
    if (!defaultEngine) {
        defaultEngine = createReadinessEngine();
    }
    return defaultEngine;
}

/**
 * Reset the singleton engine (useful for testing)
 */
export function resetReadinessEngine(): void {
    defaultEngine = null;
}

/**
 * Check if a skill is ready to execute
 *
 * Convenience function that uses the singleton engine.
 * Validates tool availability before execution.
 *
 * @param skill - The skill to check
 * @param context - Runtime context (reserved for future checks)
 * @returns Readiness result with all issues found
 *
 * @example
 * ```typescript
 * const result = checkReadiness(skill, {});
 *
 * if (!result.canRun) {
 *     console.log('Cannot run skill:', result.errors);
 * }
 * ```
 */
export function checkReadiness(skill: Skill, context: ReadinessContext): ExecutionReadiness {
    return getReadinessEngine().checkReadiness(skill, context);
}

/**
 * Format readiness result for display
 *
 * Creates a human-readable summary of readiness issues.
 *
 * @param skillId - The skill ID for context
 * @param result - The readiness result to format
 * @returns Formatted string for display
 */
export function formatReadinessResult(skillId: string, result: ExecutionReadiness): string {
    const lines: string[] = [];

    if (result.canRun && result.warnings.length === 0) {
        lines.push(`✅ Skill '${skillId}' is ready to run`);
        return lines.join('\n');
    }

    if (!result.canRun) {
        lines.push(`❌ Cannot run skill '${skillId}':\n`);
        for (const error of result.errors) {
            lines.push(`  • ${error.message}`);
            if (error.suggestion) {
                lines.push(`    💡 ${error.suggestion}`);
            }
        }
    }

    if (result.warnings.length > 0) {
        if (result.canRun) {
            lines.push(`⚠️ Skill '${skillId}' has ${result.warnings.length} warning(s):\n`);
        } else {
            lines.push(`\n⚠️ Warnings:\n`);
        }
        for (const warning of result.warnings) {
            lines.push(`  • ${warning.message}`);
            if (warning.suggestion) {
                lines.push(`    💡 ${warning.suggestion}`);
            }
        }
    }

    return lines.join('\n');
}
