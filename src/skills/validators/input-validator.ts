/**
 * Input Validator
 *
 * Runtime validation of skill input values.
 * Used by the command handler before and during execution.
 */

import type { Skill, SkillInput, ConfirmationOption } from '../types';
import type { InputValidationResult, SingleInputValidationResult } from './types';

/**
 * Parse a string to a boolean using the single accepted vocabulary
 * (`true`/`false`/`1`/`0`, case-insensitive). Returns `undefined` when the string
 * is not a recognized boolean token, so callers can coerce (use the value, falling
 * back to `false`) or validate (treat `undefined` as "not a boolean") from one
 * source of truth — argument-parser's coerceValue and validateSingleInput share it.
 */
export function parseBoolean(value: string): boolean | undefined {
    switch (value.toLowerCase()) {
        case 'true':
        case '1':
            return true;
        case 'false':
        case '0':
            return false;
        default:
            return undefined;
    }
}

/**
 * Validate a single input value against its definition
 *
 * Use this for real-time validation during input collection.
 * This is the shared validation logic used by both validateInputs
 * and the interactive input handler.
 *
 * @param input - The input definition
 * @param value - The value to validate
 * @returns Validation result with optional error message
 */
export function validateSingleInput(
    input: SkillInput,
    value: unknown
): SingleInputValidationResult {
    // Skip validation if not provided and not required
    if (value === undefined || value === null) {
        if (input.required) {
            return { valid: false, error: `Missing required input: ${input.name}` };
        }
        return { valid: true };
    }

    // Empty string check for required inputs
    if (input.required && value === '') {
        return { valid: false, error: `Missing required input: ${input.name}` };
    }

    // Type validation with coercion support
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== input.type) {
        // Allow string to be coerced to number
        if (input.type === 'number' && typeof value === 'string' && !isNaN(Number(value))) {
            // Valid - string can be coerced to number
        }
        // Allow string to be coerced to boolean (shared vocabulary with coerceValue)
        else if (input.type === 'boolean' && typeof value === 'string') {
            if (parseBoolean(value) === undefined) {
                return {
                    valid: false,
                    error: `Input '${input.name}' should be boolean (true/false), got '${value}'`
                };
            }
            // Valid - string can be coerced to boolean
        } else {
            return {
                valid: false,
                error: `Input '${input.name}' should be ${input.type}, got ${actualType}`
            };
        }
    }

    // Pattern validation for strings
    if (input.pattern && typeof value === 'string') {
        const regex = new RegExp(input.pattern);
        if (!regex.test(value)) {
            return {
                valid: false,
                error: `Input '${input.name}' does not match pattern: ${input.pattern}`
            };
        }
    }

    // Enum validation
    if (input.enum && input.enum.length > 0) {
        if (!input.enum.includes(String(value))) {
            return {
                valid: false,
                error: `Input '${input.name}' must be one of: ${input.enum.join(', ')}`
            };
        }
    }

    return { valid: true };
}

/**
 * Validate all inputs against skill requirements
 *
 * Checks:
 * - Required inputs are present
 * - Types match declarations
 * - Patterns match (for strings)
 * - Enum values are valid
 *
 * @param skill - The skill definition
 * @param inputs - The provided inputs
 * @returns Validation result with any errors
 */
export function validateInputs(
    skill: Skill,
    inputs: Record<string, unknown>
): InputValidationResult {
    const errors: string[] = [];

    for (const input of skill.inputs) {
        const value = inputs[input.name];
        const result = validateSingleInput(input, value);

        if (!result.valid && result.error) {
            errors.push(result.error);
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Apply default values to inputs
 *
 * For any input that has a default value defined and wasn't provided,
 * adds the default value to the result.
 *
 * @param skill - The skill definition
 * @param inputs - The provided inputs
 * @returns Inputs with defaults applied
 */
export function applyDefaults(
    skill: Skill,
    inputs: Record<string, unknown>
): Record<string, unknown> {
    const result = { ...inputs };

    for (const input of skill.inputs) {
        if (result[input.name] === undefined && input.default !== undefined) {
            result[input.name] = input.default;
            continue;
        }

        if (result[input.name] === undefined && !input.required) {
            result[input.name] = null;
        }
    }

    return result;
}

/**
 * Parse a user's response to a confirmation prompt
 *
 * Supports:
 * - Numeric selection (1, 2, 3...)
 * - "cancel" keyword for abort
 *
 * @param response - The user's text response
 * @param options - Available confirmation options
 * @returns The selected option, or null if response is invalid
 */
export function parseConfirmationResponse(
    response: string,
    options: ConfirmationOption[]
): ConfirmationOption | null {
    const input = response.trim();

    // Try numeric match (1, 2, 3...)
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
        return options[num - 1];
    }

    // Special case: "cancel" always maps to abort action (escape hatch)
    if (input.toLowerCase() === 'cancel') {
        const abortOption = options.find(o => o.action === 'abort');
        if (abortOption) {
            return abortOption;
        }
    }

    return null;
}
