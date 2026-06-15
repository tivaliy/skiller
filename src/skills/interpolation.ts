/**
 * Template Interpolation Engine (LiquidJS)
 *
 * Uses LiquidJS for powerful template rendering with:
 * - Simple variables: {{ name }}
 * - Nested paths: {{ profile.email }}, {{ outputs.report.title }}
 * - Input access: {{ inputs.topic }}
 * - Output access: {{ outputs.draft }}
 * - Conditionals: {% if value == 'something' %}...{% endif %}
 * - Loops: {% for item in items %}...{% endfor %}
 * - Filters: {{ name | upcase }}, {{ items | size }}
 */

import { Liquid } from 'liquidjs';
import * as vscode from 'vscode';
import { ExecutionContext } from './types';

/**
 * Get the current workspace folder path
 */
function getWorkspaceFolder(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : '';
}

/**
 * Options for template interpolation
 */
export interface InterpolationOptions {
    /**
     * If true, throw error when a variable is undefined.
     * If false, render undefined variables as empty string.
     * Default: true (fail fast)
     */
    strictVariables?: boolean;
}

/**
 * Create a LiquidJS engine with the specified settings
 */
function createEngine(strict: boolean): Liquid {
    return new Liquid({
        // Throw on undefined variables when strict mode is enabled
        strictVariables: strict,
        // Don't throw on undefined filters
        strictFilters: false,
        // Treat falsy values consistently (JS-style)
        jsTruthy: true,
        // Allow lenient comparisons in conditions
        lenientIf: true,
        // Keep empty lines (preserve markdown formatting)
        trimTagLeft: false,
        trimTagRight: false,
        trimOutputLeft: false,
        trimOutputRight: false,
    });
}

/**
 * Cached engine instances for performance
 */
const strictEngine = createEngine(true);
const permissiveEngine = createEngine(false);

/**
 * Interpolate all template expressions in a string
 *
 * Supports Liquid syntax: {{ var }}, {% if %}, {% for %}, and filters.
 *
 * @param template The template string to interpolate
 * @param context The execution context with inputs and outputs
 * @param options Interpolation options (strictVariables defaults to true)
 * @throws Error if strictVariables is true and a variable is undefined
 */
export function interpolate(
    template: string,
    context: ExecutionContext,
    options: InterpolationOptions = {}
): string {
    // Default to strict mode (fail fast on missing variables)
    const strict = options.strictVariables ?? true;
    const engine = strict ? strictEngine : permissiveEngine;

    try {
        const ctx = buildTemplateContext(context);
        return engine.parseAndRenderSync(template, ctx);
    } catch (error) {
        // In strict mode, let the error propagate for better debugging
        if (strict) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Template interpolation failed: ${message}`);
        }
        // In permissive mode, log and return error marker
        console.error('Template interpolation error:', error);
        return `[Template Error: ${error instanceof Error ? error.message : 'Unknown'}]\n${template}`;
    }
}

/**
 * Build the template context from ExecutionContext
 *
 * Creates a flat namespace where:
 * - inputs.* are directly accessible
 * - outputs.* are directly accessible
 * - Both are also accessible via 'inputs' and 'outputs' objects
 */
function buildTemplateContext(context: ExecutionContext): Record<string, unknown> {
    const ctx: Record<string, unknown> = {
        // Namespaced access
        inputs: context.inputs,
        outputs: context.outputs,

        // Metadata
        currentStep: context.currentStep,
        totalSteps: context.totalSteps,
        startTime: context.startTime,
        stepTimes: context.stepTimes,
        availableMcps: context.availableMcps,

        // Skill info
        skill: {
            id: context.skill?.id,
            name: context.skill?.name,
            version: context.skill?.version,
        },

        // VS Code workspace (follows VS Code naming convention)
        workspaceFolder: getWorkspaceFolder(),
    };

    // Spread inputs at top level for convenience (e.g., {{ topic }} instead of {{ inputs.topic }})
    for (const [key, value] of Object.entries(context.inputs)) {
        if (!(key in ctx)) {
            ctx[key] = value;
        }
    }

    // Spread outputs at top level for convenience (e.g., {{ draft.title }} instead of {{ outputs.draft.title }})
    for (const [key, value] of Object.entries(context.outputs)) {
        if (!(key in ctx)) {
            ctx[key] = value;
        }
    }

    return ctx;
}

/**
 * Evaluate a conditional expression
 *
 * Supports:
 * - Truthy/falsy: {{ variable }}
 * - Negation: !{{ variable }}
 * - Equality: {{ variable }} == 'value'
 * - Inequality: {{ variable }} != 'value'
 * - Liquid syntax: variable == 'value'
 *
 * Note: Conditions always use permissive mode - missing variables evaluate to falsy.
 * This allows conditions like "when: outputs.data.exists" to work properly.
 */
export function evaluateCondition(expression: string, context: ExecutionContext): boolean {
    const trimmed = expression.trim();

    // Handle negation
    if (trimmed.startsWith('!')) {
        return !evaluateCondition(trimmed.slice(1).trim(), context);
    }

    // Build context for evaluation
    const ctx = buildTemplateContext(context);

    // Wrap in Liquid if/endif to evaluate
    // Always use permissive engine for conditions - missing vars should be falsy, not errors
    const template = `{% if ${trimmed} %}true{% else %}false{% endif %}`;

    try {
        const result = permissiveEngine.parseAndRenderSync(template, ctx);
        return result.trim() === 'true';
    } catch (error) {
        console.warn('Condition evaluation error:', error);
        return false;
    }
}

/**
 * Check whether a `when` condition is syntactically valid, using the SAME engine
 * and wrapping as runtime `evaluateCondition` — so the validator cannot accept a
 * condition that the runtime would silently reject (and evaluate to false).
 *
 * Mirrors evaluateCondition's leading-`!` handling. Returns an error message if
 * the condition fails to parse, otherwise null.
 */
export function tryCompileCondition(expression: string): string | null {
    let trimmed = expression.trim();
    // Strip leading `!` recursively, exactly as evaluateCondition does (it recurses
    // on each negation). A single strip would leave `!outputs.x` for an input like
    // `!!outputs.x`, which LiquidJS rejects — falsely failing a condition that is
    // valid at runtime.
    while (trimmed.startsWith('!')) {
        trimmed = trimmed.slice(1).trim();
    }
    if (trimmed === '') return null; // emptiness is handled by the caller

    try {
        permissiveEngine.parse(`{% if ${trimmed} %}true{% else %}false{% endif %}`);
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/**
 * Extract the EXTERNAL variable references a template depends on (inputs, outputs,
 * builtins) — excluding template-local variables defined by {% assign %},
 * {% capture %}, or {% for %} loops.
 *
 * Uses LiquidJS's static analysis with the SAME engine the runtime uses (rather
 * than regex), so it correctly handles filter arguments, bracket access, nested
 * paths, and {% raw %} blocks, and cannot drift from runtime behavior.
 *
 * Returns dotted paths (e.g. 'outputs.draft', 'profile.email'). Bracket access is
 * reduced to its static prefix ('items[0]' → 'items') so callers keying on
 * '.'-separated paths work; a dynamic key like `outputs[key]` still surfaces
 * `key` as its own dependency. Returns [] for templates that fail to parse —
 * syntax errors are surfaced by dedicated validators, not here.
 */
export function extractExternalVariables(template: string): string[] {
    let fullPaths: string[];
    let globalRoots: string[];
    try {
        fullPaths = permissiveEngine.fullVariablesSync(template);
        globalRoots = permissiveEngine.globalVariablesSync(template);
    } catch {
        return [];
    }

    // globalVariablesSync already excludes locals (assign/capture/for vars); keep
    // only full dotted paths whose root is one of those external variables.
    const externalRoots = new Set(globalRoots.map(variableRoot));
    const result = new Set<string>();
    for (const fullPath of fullPaths) {
        if (externalRoots.has(variableRoot(fullPath))) {
            // Reduce bracket access to its static dotted prefix for scope checks.
            result.add(fullPath.split('[')[0]);
        }
    }
    return [...result];
}

/** Leading identifier of a variable path: 'profile.email' → 'profile', 'items[0]' → 'items'. */
function variableRoot(path: string): string {
    return path.split(/[.\[]/)[0];
}

/**
 * Create a minimal context for testing/validation
 */
export function createEmptyContext(): ExecutionContext {
    return {
        inputs: {},
        outputs: {},
        currentStep: 0,
        totalSteps: 0,
        skill: null as unknown as ExecutionContext['skill'],
        startTime: Date.now(),
        stepTimes: {},
        availableMcps: []
    };
}

/**
 * Interpolate all template expressions in an object recursively
 *
 * Handles nested objects, arrays, and string values.
 * Non-string primitive values (numbers, booleans, null) are passed through unchanged.
 *
 * @param obj The object to interpolate (typically step.params)
 * @param context The execution context with inputs and outputs
 * @param options Interpolation options (strictVariables defaults to true)
 * @returns The interpolated object with all templates resolved
 *
 * @example
 * ```typescript
 * const params = {
 *   filePath: "{{inputs.filename}}",
 *   content: "{{outputs.previous_step}}",
 *   nested: { key: "{{inputs.key}}" }
 * };
 * const result = interpolateObject(params, context);
 * // result: { filePath: "myfile.txt", content: "...", nested: { key: "..." } }
 * ```
 */
export function interpolateObject<T>(
    obj: T,
    context: ExecutionContext,
    options: InterpolationOptions = {}
): T {
    return interpolateValue(obj, context, options) as T;
}

/**
 * Recursively interpolate a value (internal helper)
 */
function interpolateValue(
    value: unknown,
    context: ExecutionContext,
    options: InterpolationOptions
): unknown {
    // Handle null/undefined
    if (value === null || value === undefined) {
        return value;
    }

    // Handle strings - interpolate templates
    if (typeof value === 'string') {
        return interpolate(value, context, options);
    }

    // Handle arrays - interpolate each element
    if (Array.isArray(value)) {
        return value.map(item => interpolateValue(item, context, options));
    }

    // Handle objects - interpolate each property value
    if (typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value)) {
            result[key] = interpolateValue(val, context, options);
        }
        return result;
    }

    // Primitives (numbers, booleans) pass through unchanged
    return value;
}
