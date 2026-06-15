/**
 * Validation Engine Factory
 *
 * Creates pre-configured validation engines with all default validators.
 * Also provides convenience functions for common validation scenarios.
 */

import type { Skill } from '../types';
import type { ValidationResult, ValidationOptions } from './types';
import { ValidationEngine } from './engine';
import { allValidators } from './rules';

/**
 * Create a validation engine with all default validators registered
 */
export function createValidationEngine(): ValidationEngine {
    const engine = new ValidationEngine();
    engine.registerAll(allValidators);
    return engine;
}

// Singleton instance for common use
let defaultEngine: ValidationEngine | null = null;

/**
 * Get the default validation engine (singleton)
 *
 * Creates the engine on first call, reuses on subsequent calls.
 * Use createValidationEngine() if you need a fresh instance.
 */
export function getValidationEngine(): ValidationEngine {
    if (!defaultEngine) {
        defaultEngine = createValidationEngine();
    }
    return defaultEngine;
}

/**
 * Validate a skill using the default engine
 *
 * Runs semantic validation on a skill object. This function is designed
 * to complement Zod validation in the parser:
 *
 * - **Parser (Zod)**: Structural validation - types, required fields, unknown keys
 * - **validateSkill()**: Semantic validation - references, uniqueness, file existence
 *
 * For skills loaded from YAML, always use `parseSkillFromContent()` first,
 * which handles Zod validation. This function includes basic sanity checks
 * (missing name, no steps) as defense-in-depth for programmatically-constructed
 * skills, but the parser is the primary structural gatekeeper.
 *
 * @param skill - The skill to validate (should be structurally valid)
 * @param options - Validation options
 * @returns Promise resolving to validation result with all issues found
 *
 * @example
 * ```typescript
 * // For YAML skills (recommended flow):
 * const parseResult = parseSkillFromContent(yaml, dir, source);
 * if (parseResult.success) {
 *   const validationResult = await validateSkill(parseResult.skill);
 * }
 *
 * // For programmatic skills (sanity checks will catch obvious issues):
 * const result = await validateSkill(constructedSkill);
 * ```
 */
export async function validateSkill(skill: Skill, options?: ValidationOptions): Promise<ValidationResult> {
    return getValidationEngine().validate(skill, options);
}


/**
 * Format validation result for display
 *
 * Creates a human-readable summary of validation results.
 *
 * @param skillId - The skill ID for context
 * @param result - The validation result to format
 * @returns Formatted string for display
 */
export function formatValidationResult(skillId: string, result: ValidationResult): string {
    const lines: string[] = [];

    if (result.valid && result.warnings.length === 0) {
        lines.push(`✅ Skill '${skillId}' is valid`);
        return lines.join('\n');
    }

    if (!result.valid) {
        lines.push(`❌ Skill '${skillId}' has ${result.errors.length} error(s):\n`);
        for (const error of result.errors) {
            const location = error.location?.field ? ` (${error.location.field})` : '';
            lines.push(`  • [${error.ruleId}]${location}: ${error.message}`);
            if (error.suggestion) {
                lines.push(`    💡 ${error.suggestion}`);
            }
        }
    }

    if (result.warnings.length > 0) {
        if (result.valid) {
            lines.push(`⚠️ Skill '${skillId}' has ${result.warnings.length} warning(s):\n`);
        } else {
            lines.push(`\n⚠️ Warnings:\n`);
        }
        for (const warning of result.warnings) {
            const location = warning.location?.field ? ` (${warning.location.field})` : '';
            lines.push(`  • [${warning.ruleId}]${location}: ${warning.message}`);
            if (warning.suggestion) {
                lines.push(`    💡 ${warning.suggestion}`);
            }
        }
    }

    // Add timing info
    lines.push(`\n🏁 Validation completed in ${result.duration}ms (phases: ${result.phasesRun.join(', ')})`);

    return lines.join('\n');
}
