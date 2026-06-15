/**
 * Step Schema
 *
 * Defines the Zod schema for skill step definitions.
 * This is the single source of truth for step validation.
 */

import { z } from 'zod';

/**
 * Valid step types - determines execution behavior
 */
export const STEP_TYPES = ['llm', 'tool', 'confirmation'] as const;
export const stepTypeSchema = z.enum(STEP_TYPES);
export type StepType = z.infer<typeof stepTypeSchema>;

/**
 * Tool mode for LLM steps - controls how the LLM uses available tools
 */
export const TOOL_MODES = ['auto', 'required'] as const;
export const toolModeSchema = z.enum(TOOL_MODES);
export type ToolMode = z.infer<typeof toolModeSchema>;

/**
 * Valid confirmation actions
 */
export const CONFIRMATION_ACTIONS = ['continue', 'abort', 'goto'] as const;
export const confirmationActionSchema = z.enum(CONFIRMATION_ACTIONS);
export type ConfirmationAction = z.infer<typeof confirmationActionSchema>;

/**
 * Confirmation option schema
 */
export const confirmationOptionSchema = z.object({
    /**
     * Display label for this option
     */
    label: z.string().min(1, 'Option label is required'),

    /**
     * Action to take when selected
     */
    action: confirmationActionSchema,

    /**
     * Target step ID for 'goto' action
     */
    goto_step: z.string().optional()
}).strict();

export type ConfirmationOption = z.infer<typeof confirmationOptionSchema>;

/**
 * Base step definition schema (raw YAML format, using snake_case)
 *
 * This is separated from cross-field validation so we can safely
 * access `.shape` for known keys without relying on Zod internals.
 *
 * Note: The `type` field is REQUIRED - no default value.
 * This is a deliberate design choice to ensure explicit step types.
 */
const stepDefinitionBaseSchema = z.object({
    /**
     * Unique step identifier (required)
     * Must start with letter, contain only alphanumeric + underscore/hyphen
     */
    id: z.string()
        .min(1, 'Step ID is required')
        .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Step ID must start with a letter and contain only letters, numbers, underscores, and hyphens'),

    /**
     * Step type: 'llm', 'confirmation', or 'tool' (required)
     * No default - must be explicitly specified
     */
    type: stepTypeSchema,

    /**
     * Path to step markdown file (relative to skill directory)
     */
    file: z.string().optional(),

    /**
     * Inline message for confirmation/llm steps (alternative to file)
     */
    message: z.string().optional(),

    /**
     * Step description
     */
    description: z.string().optional(),

    /**
     * MCP tools available for LLM steps (agentic tool use)
     */
    tools: z.array(z.string()).optional(),

    /**
     * Specific MCP tool to invoke for tool steps
     * Required when type is 'tool'
     */
    tool: z.string().optional(),

    /**
     * Parameters for tool steps (type: 'tool')
     * Supports {{variable}} interpolation
     */
    params: z.record(z.unknown()).optional(),

    /**
     * Model specification for this step (alias or direct ID)
     */
    model: z.string().optional(),

    /**
     * Tool mode for LLM steps with tools
     * - 'auto': LLM decides whether to call tools
     * - 'required': LLM must call one of the provided tools
     */
    tool_mode: toolModeSchema.optional(),

    /**
     * Output variable name for this step's result
     * Must start with letter, contain only alphanumeric + underscore/hyphen
     */
    output: z.string()
        .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Output name must start with a letter and contain only letters, numbers, underscores, and hyphens')
        .optional(),

    /**
     * Conditional execution expression (Liquid syntax)
     */
    when: z.string().optional(),

    /**
     * Step IDs this step depends on (for validation)
     */
    requires: z.array(z.string()).optional(),

    /**
     * Options for confirmation steps
     */
    options: z.array(confirmationOptionSchema).optional()
}).strict();

/**
 * Known keys for step definitions (derived from base schema)
 * Using base schema avoids accessing Zod internals (._def.schema.shape)
 */
export const KNOWN_STEP_KEYS = new Set(Object.keys(stepDefinitionBaseSchema.shape));

/**
 * Full step definition schema with cross-field validation
 */
export const stepDefinitionSchema = stepDefinitionBaseSchema
    // Cross-field validation: tool steps require 'tool' property
    .superRefine((data, ctx) => {
        if (data.type === 'tool') {
            if (!data.tool) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['tool'],
                    message: "Tool steps require 'tool' property specifying which MCP tool to invoke"
                });
            }
            if (data.tools && data.tools.length > 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['tools'],
                    message: "Tool steps should not have 'tools' array. Use 'tool' (singular) with 'params'"
                });
            }
            if (data.tool_mode) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['tool_mode'],
                    message: "Tool steps should not have 'tool_mode'. tool_mode only applies to LLM steps"
                });
            }
        }

        if (data.type === 'llm') {
            // LLM steps need either file or message
            if (!data.file && !data.message) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['file'],
                    message: "LLM steps require either 'file' or 'message' property for the prompt"
                });
            }
            // toolMode: required needs tools
            if (data.tool_mode === 'required' && (!data.tools || data.tools.length === 0)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['tool_mode'],
                    message: "tool_mode 'required' requires tools array - LLM must call a tool but none available"
                });
            }
        }

        if (data.type === 'confirmation' && !data.file && !data.message) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['message'],
                message: "Confirmation steps require either 'message' or 'file' property"
            });
        }

        // Can't have both file and message
        if (data.file && data.message) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['message'],
                message: "Step has both 'message' and 'file' - only one is allowed"
            });
        }

        // goto action requires goto_step
        if (data.options) {
            data.options.forEach((option, index) => {
                if (option.action === 'goto' && !option.goto_step) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['options', index, 'goto_step'],
                        message: `Option '${option.label}' has 'goto' action but missing 'goto_step' property`
                    });
                }
            });
        }
    });

/**
 * Inferred TypeScript types from the schema
 */
export type RawStepDefinition = z.input<typeof stepDefinitionSchema>;
export type StepDefinition = z.output<typeof stepDefinitionSchema>;

/**
 * Known keys for confirmation options (derived from schema)
 */
export const KNOWN_OPTION_KEYS = new Set(Object.keys(confirmationOptionSchema.shape));
