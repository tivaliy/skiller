/**
 * Argument Parser
 *
 * Parses /skill command arguments into skill ID and parameters.
 * Handles positional arguments, named parameters, and type coercion.
 *
 * Single Responsibility: Parse and transform command arguments.
 */

import type { Skill } from '../../skills';
import { parseBoolean } from '../../skills';

/**
 * Parsed arguments result
 */
export interface ParsedArgs {
    skillId: string;
    params: Record<string, string>;
}

/**
 * Tokenize an argument string, respecting single/double quotes so values may
 * contain spaces (e.g. `msg="hello world"` or `'two words'`). Quote characters
 * are stripped, shell-style.
 */
function tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let inToken = false;

    for (const ch of input) {
        if (quote) {
            if (ch === quote) quote = null;
            else current += ch;
            inToken = true;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            inToken = true;
        } else if (/\s/.test(ch)) {
            if (inToken) {
                tokens.push(current);
                current = '';
                inToken = false;
            }
        } else {
            current += ch;
            inToken = true;
        }
    }
    if (inToken) tokens.push(current);

    return tokens;
}

/**
 * Parse command arguments into skill name and parameters
 *
 * Supports two formats:
 * - Named: `/skill my-skill foo=bar baz="two words"`
 * - Positional: `/skill my-skill value1 "value with spaces"`
 *
 * Quoted values may contain spaces. Positional args are numbered in the order
 * they appear (`_arg1`, `_arg2`, …) regardless of interleaved named args, so an
 * interleaved named arg never creates a gap that would drop a later positional.
 *
 * @param prompt - Raw command prompt string
 * @returns Parsed skill ID and parameters
 */
export function parseArgs(prompt: string): ParsedArgs {
    const tokens = tokenize(prompt.trim());
    const skillId = tokens[0] || '';
    const params: Record<string, string> = {};
    let positional = 0;

    for (let i = 1; i < tokens.length; i++) {
        const token = tokens[i];
        const eq = token.indexOf('=');
        // Named only when '=' is present and the key is non-empty.
        if (eq > 0) {
            params[token.slice(0, eq)] = token.slice(eq + 1);
        } else {
            params[`_arg${++positional}`] = token;
        }
    }

    return { skillId, params };
}

/**
 * Map positional arguments to skill inputs
 *
 * First applies named parameters, then maps positional args
 * to remaining inputs in declaration order.
 *
 * @param skill - Skill definition with input declarations
 * @param params - Parsed parameters (named and positional)
 * @returns Mapped input values with proper types
 */
export function mapPositionalArgs(
    skill: Skill,
    params: Record<string, string>
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let argIndex = 1;

    // First, add all named parameters
    for (const [key, value] of Object.entries(params)) {
        if (!key.startsWith('_arg')) {
            result[key] = coerceValue(value, skill.inputs.find(i => i.name === key)?.type);
        }
    }

    // Then, map positional arguments to remaining required inputs
    for (const input of skill.inputs) {
        if (result[input.name] !== undefined) {
            continue;
        }
        const positionalKey = `_arg${argIndex}`;
        if (params[positionalKey] !== undefined) {
            result[input.name] = coerceValue(params[positionalKey], input.type);
            argIndex++;
        }
    }

    return result;
}

/**
 * Coerce string value to appropriate type
 *
 * Returns the original string if coercion fails (e.g., invalid number).
 * Validation will catch type mismatches downstream.
 *
 * @param value - String value to coerce
 * @param type - Target type (number, boolean, array, or string)
 * @returns Coerced value or original string
 */
export function coerceValue(value: string, type?: string): unknown {
    if (!type) return value;

    switch (type) {
        case 'number': {
            const num = Number(value);
            // Return original string if NaN - validation will catch the type mismatch
            if (Number.isNaN(num)) {
                return value;
            }
            return num;
        }
        case 'boolean':
            // Shared vocabulary with the input validator; unrecognized → false
            // (validation surfaces a clearer error for non-boolean strings).
            return parseBoolean(value) ?? false;
        case 'array':
            return value.split(',').map(s => s.trim());
        default:
            return value;
    }
}
