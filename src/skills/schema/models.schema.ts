/**
 * Models Schema
 *
 * Defines the Zod schema for skill model configuration.
 * This is the single source of truth for models section validation.
 */

import { z } from 'zod';

/**
 * Models configuration schema (raw YAML format)
 *
 * Validates models section before normalization.
 * Uses strict mode to reject unknown keys.
 */
export const modelsConfigSchema = z.object({
    /**
     * Default model for all steps that don't specify a model
     */
    default: z.string().optional(),

    /**
     * Model aliases map friendly names to model IDs
     *
     * Example:
     * ```yaml
     * aliases:
     *   fast: gpt-4o-mini
     *   smart: gpt-4o
     * ```
     */
    aliases: z.record(z.string(), z.string()).optional()
}).strict();

/**
 * Inferred TypeScript types from the schema
 */
export type RawModelsConfig = z.input<typeof modelsConfigSchema>;
export type ModelsConfig = z.output<typeof modelsConfigSchema>;

/**
 * Known keys for models section (derived from schema)
 */
export const KNOWN_MODELS_KEYS = new Set(Object.keys(modelsConfigSchema.shape));
