/**
 * Skill Schema
 *
 * Master Zod schema for skill.yaml validation.
 * This is the single source of truth for skill structure.
 *
 * Combines all sub-schemas (input, step, tools, models) into
 * a complete skill definition schema.
 */

import { z } from 'zod';
import { inputDefinitionSchema, INPUT_TYPES } from './input.schema';
import { stepDefinitionSchema, STEP_TYPES, TOOL_MODES, CONFIRMATION_ACTIONS } from './step.schema';
import { toolsConfigSchema } from './tools.schema';
import { modelsConfigSchema } from './models.schema';
import { parseSink, KNOWN_SINK_TOKENS } from '../output/sinks';

// Re-export constants for convenience
export { INPUT_TYPES } from './input.schema';
export { STEP_TYPES, TOOL_MODES, CONFIRMATION_ACTIONS } from './step.schema';

/**
 * Valid error handling strategies
 */
export const ERROR_STRATEGIES = ['abort', 'continue'] as const;
export const errorStrategySchema = z.enum(ERROR_STRATEGIES);
export type ErrorStrategy = z.infer<typeof errorStrategySchema>;

/**
 * Output configuration schema
 */
export const outputConfigSchema = z.object({
    /**
     * Summary template with {{variable}} interpolation
     * Rendered after skill completion
     */
    summary: z.string().optional(),

    /**
     * Output sink: where the rendered summary is delivered when the skill completes.
     * e.g. 'newDocument', 'file:<path>', 'editor.replaceSelection', 'editor.insert', 'diff'.
     * Undefined = chat only (existing behavior).
     */
    to: z.string()
        .refine(v => v.includes('{{') || parseSink(v) !== undefined, {
            message: `output.to must be one of ${KNOWN_SINK_TOKENS.join(', ')}, file:<path>, or a {{template}}`
        })
        .optional()
}).strict();

/**
 * Semver pattern for version validation
 */
const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;

/**
 * Complete skill schema (raw YAML format, using snake_case)
 *
 * Validates the entire skill.yaml structure before normalization.
 * Uses strict mode to reject unknown keys at all levels.
 *
 * Key design decisions:
 * - `name` is required (human-readable identifier)
 * - `steps` is required with at least one step
 * - `type` in steps is required (no implicit defaults)
 * - All unknown keys are rejected (typo detection)
 */
export const skillSchema = z.object({
    /**
     * Human-readable skill name (required)
     */
    name: z.string().min(1, 'Skill name is required'),

    /**
     * Skill description (recommended)
     */
    description: z.string().default(''),

    /**
     * Semantic version (e.g., "1.0.0")
     */
    version: z.string()
        .refine(
            (val) => semverPattern.test(val),
            { message: 'Version should follow semver format (x.y.z)' }
        )
        .default('1.0.0'),

    /**
     * Explicit skill ID (defaults to directory name if omitted)
     */
    id: z.string().optional(),

    /**
     * Skill author or team
     */
    author: z.string().optional(),

    /**
     * Input parameters for the skill
     */
    inputs: z.array(inputDefinitionSchema)
        .default([])
        .superRefine((inputs, ctx) => {
            const seen = new Set<string>();
            for (let i = 0; i < inputs.length; i++) {
                if (seen.has(inputs[i].name)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: [i, 'name'],
                        message: `Duplicate input name: '${inputs[i].name}'`
                    });
                }
                seen.add(inputs[i].name);
            }
        }),

    /**
     * Tool configuration (aliases)
     */
    tools: toolsConfigSchema.default({ aliases: {} }),

    /**
     * Model configuration (default and aliases)
     */
    models: modelsConfigSchema.optional(),

    /**
     * Execution steps (required, at least one)
     */
    steps: z.array(stepDefinitionSchema)
        .min(1, 'Skill must have at least one step')
        .superRefine((steps, ctx) => {
            const seenIds = new Set<string>();
            const seenOutputs = new Set<string>();
            for (let i = 0; i < steps.length; i++) {
                // Duplicate step IDs
                if (seenIds.has(steps[i].id)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: [i, 'id'],
                        message: `Duplicate step ID: '${steps[i].id}'`
                    });
                }
                seenIds.add(steps[i].id);

                // Duplicate output names
                if (steps[i].output) {
                    if (seenOutputs.has(steps[i].output!)) {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            path: [i, 'output'],
                            message: `Duplicate output variable: '${steps[i].output}'`
                        });
                    }
                    seenOutputs.add(steps[i].output!);
                }
            }
        }),

    /**
     * Error handling strategy
     * - 'abort': Stop on first error (default)
     * - 'continue': Continue despite errors
     */
    on_error: errorStrategySchema.default('abort'),

    /**
     * Output configuration
     */
    output: outputConfigSchema.optional()
}).strict();

/**
 * Inferred TypeScript types from the schema
 *
 * - RawSkillYaml: The input type (what you parse from YAML)
 * - SkillYaml: The output type (after defaults applied)
 */
export type RawSkillYaml = z.input<typeof skillSchema>;
export type SkillYaml = z.output<typeof skillSchema>;

/**
 * Known top-level keys (derived from schema)
 * Used for typo suggestions in error messages
 */
export const KNOWN_TOP_LEVEL_KEYS = new Set(Object.keys(skillSchema.shape));

/**
 * Known output keys (derived from schema)
 */
export const KNOWN_OUTPUT_KEYS = new Set(Object.keys(outputConfigSchema.shape));

/**
 * Validate raw YAML against the skill schema
 *
 * @param rawYaml - Parsed YAML object (from js-yaml)
 * @returns Validation result with parsed data or errors
 *
 * @example
 * ```typescript
 * const yaml = jsYaml.load(content);
 * const result = validateSkillYaml(yaml);
 * if (result.success) {
 *   const skill = result.data;
 * } else {
 *   console.error(result.error.issues);
 * }
 * ```
 */
export function validateSkillYaml(rawYaml: unknown): z.SafeParseReturnType<unknown, SkillYaml> {
    return skillSchema.safeParse(rawYaml);
}

/**
 * Parse and validate skill YAML (throws on error)
 *
 * @param rawYaml - Parsed YAML object
 * @returns Validated skill data
 * @throws ZodError if validation fails
 */
export function parseSkillYaml(rawYaml: unknown): SkillYaml {
    return skillSchema.parse(rawYaml);
}
