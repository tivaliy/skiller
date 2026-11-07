/**
 * Run core: launch-input logic shared by every runner (chat and native).
 *
 * vscode-free: editor reads are injected (`captureLive`) or hidden behind the
 * context module's accessors, so this is unit-testable without a host.
 */

import type { Skill, SkillInput, InputType } from '../types';
import type { EditorContextSnapshot } from '../context/types';
import type { LaunchContextStore } from '../launch-context-store';
import { resolveContextInputs, resolveInputs } from '../context/resolver';
import { validateSingleInput, parseBoolean } from '../validators';
import { hasValue } from '../utils';

/**
 * Coerce string value to appropriate type
 *
 * Returns the original string if coercion fails (e.g., invalid number).
 * Validation will catch type mismatches downstream.
 */
export function coerceValue(value: string, type?: InputType): unknown {
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

/**
 * Resolve editor-context inputs at launch: prefer a snapshot stashed by an
 * editor trigger (captured at trigger time, before focus moved); otherwise
 * capture live (the chat-typed path). `captureLive` is injectable for tests.
 */
export async function resolveLaunchInputs(
    skill: Skill,
    inputs: Record<string, unknown>,
    launchContextStore?: LaunchContextStore,
    captureLive: (skill: Skill, inputs: Record<string, unknown>) => Promise<Record<string, unknown>>
        = resolveContextInputs,
): Promise<Record<string, unknown>> {
    const stashed: EditorContextSnapshot | undefined = launchContextStore?.take(skill.id);
    const resolved = stashed
        ? resolveInputs(skill, inputs, stashed)
        : await captureLive(skill, inputs);
    return normalizeContextInputs(skill, inputs, resolved);
}

/**
 * Reconcile `from:`-filled values with their input definition:
 *  - coerce a raw context string to the input's declared type (number/boolean/array), and
 *  - drop a context value the input would reject (enum/pattern/type) so a triggered run
 *    falls back to its normal prompt/skip flow instead of hard-failing validation for data
 *    the user never typed.
 * Only values the context actually supplied (the input was originally empty) are touched —
 * an explicit arg or a default always wins.
 */
function normalizeContextInputs(
    skill: Skill,
    original: Record<string, unknown>,
    resolved: Record<string, unknown>
): Record<string, unknown> {
    const out = { ...resolved };
    for (const input of skill.inputs) {
        if (!input.from) continue;
        if (hasValue(original[input.name])) continue; // explicit arg / default wins
        let value = out[input.name];
        if (!hasValue(value)) continue; // context supplied nothing
        if (typeof value === 'string') {
            // Validate the RAW context string before coercing. validateSingleInput is
            // coercion-aware (a numeric/boolean string passes, a junk string fails), so a
            // code selection bound to a number/boolean/enum input is dropped here rather
            // than being silently mangled by coerceValue (which turns any non-boolean into
            // `false` and any string into an array — values that would then always validate).
            // Arrays are the exception: the validator has no string→array rule, so the
            // comma-split happens up front and the resulting array is validated below.
            if (input.type === 'array') {
                value = coerceValue(value, 'array');
            } else if (!validateSingleInput(input, value).valid) {
                delete out[input.name];
                continue;
            } else {
                value = coerceValue(value, input.type);
            }
        }
        if (validateSingleInput(input, value).valid) {
            out[input.name] = value;
        } else {
            delete out[input.name];
        }
    }
    return out;
}

/**
 * Which inputs a runner must ask the user for: required-and-empty ones, plus
 * ones carrying a `prompt` that were not explicitly provided and not already
 * filled from editor context (a `from:`-bound value counts as provided).
 */
export function inputsToAsk(
    skill: Skill,
    explicit: Record<string, unknown>,
    resolved: Record<string, unknown>
): SkillInput[] {
    return skill.inputs.filter(input => {
        const present = hasValue(resolved[input.name]);
        const wasExplicitlyProvided = input.name in explicit;

        if (input.required && !present) {
            return true;
        }

        const filledFromContext = !!input.from && !wasExplicitlyProvided && present;

        return !!(input.prompt && !wasExplicitlyProvided && !filledFromContext);
    });
}

/**
 * Parse an answer to an enum input: a 1-based option number or an exact value.
 */
export function parseEnumAnswer(
    input: SkillInput,
    answer: string
): { value: string } | { error: string } {
    const enumValues = input.enum ?? [];
    const num = parseInt(answer, 10);

    if (!isNaN(num) && num >= 1 && num <= enumValues.length) {
        return { value: enumValues[num - 1] };
    }
    if (enumValues.includes(answer)) {
        return { value: answer };
    }
    return { error: `Pick a number from 1 to ${enumValues.length} or an exact value.` };
}
