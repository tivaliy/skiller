/**
 * Input Schema
 *
 * Defines the Zod schema for skill input parameters.
 * This is the single source of truth for input validation.
 */

import { z } from 'zod';
import { KNOWN_CONTEXT_SOURCES } from '../context/sources';

/**
 * Valid input types for skill parameters
 */
export const INPUT_TYPES = ['string', 'number', 'boolean', 'array'] as const;
export const inputTypeSchema = z.enum(INPUT_TYPES);
export type InputType = z.infer<typeof inputTypeSchema>;

/**
 * Input definition schema (raw YAML format)
 *
 * Validates input parameter definitions before normalization.
 * Uses strict mode to reject unknown keys.
 */
export const inputDefinitionSchema = z.object({
    /**
     * Parameter name - must be a non-empty string
     */
    name: z.string().min(1, 'Input name is required'),

    /**
     * Data type - defaults to 'string' if not specified
     */
    type: inputTypeSchema.default('string'),

    /**
     * Human-readable description
     */
    description: z.string().default(''),

    /**
     * Whether this input is required (default: true)
     */
    required: z.boolean().default(true),

    /**
     * Default value if not provided
     * Type is validated separately based on declared type
     */
    default: z.unknown().optional(),

    /**
     * Prompt shown in interactive mode
     */
    prompt: z.string().optional(),

    /**
     * Regex validation pattern (for string inputs)
     */
    pattern: z.string()
        .refine(
            (val) => {
                try {
                    new RegExp(val);
                    return true;
                } catch {
                    return false;
                }
            },
            { message: 'Invalid regex pattern' }
        )
        .optional(),

    /**
     * Allowed values (enum validation)
     */
    enum: z.array(z.string())
        .min(1, 'Enum must have at least one value')
        .optional(),

    /**
     * Editor-context binding: resolve this input from editor state at launch
     * instead of prompting. e.g. 'selection', 'activeFile.path', 'git.staged'.
     * Validated against the known context sources so a typo is caught at parse
     * time instead of silently resolving to undefined.
     */
    from: z.string()
        .refine(v => KNOWN_CONTEXT_SOURCES.has(v), {
            message: 'input.from must be a known context source (e.g. selection, activeFile, activeFile.path, activeFile.content, activeFile.language, git.staged, git.working, diagnostics)'
        })
        .optional()
}).strict();

/**
 * Inferred TypeScript types from the schema
 */
export type RawInputDefinition = z.input<typeof inputDefinitionSchema>;
export type InputDefinition = z.output<typeof inputDefinitionSchema>;

/**
 * Known keys for input definitions (derived from schema)
 */
export const KNOWN_INPUT_KEYS = new Set(Object.keys(inputDefinitionSchema.shape));
