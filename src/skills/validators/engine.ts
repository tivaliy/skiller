/**
 * Validation Engine
 *
 * Multi-phase validation engine for skill definitions.
 * Executes validators in phases, accumulating results in a shared context.
 *
 * Architecture:
 * - Raw YAML validation (structure, types) is handled by Zod in the parser
 * - Validators here focus on semantic checks that require parsed skill data
 * - Phases execute in order: schema → semantic → template → security
 * - Each validator receives a shared ValidationContext
 * - Supports fail-fast mode for early termination
 */

import type { Skill } from '../types';
import type { ValidationPhase, ValidationOptions, ValidationResult } from './types';
import { VALIDATION_PHASES } from './types';
import { ValidationContext } from './context';

/**
 * Validator interface - each validation rule implements this
 */
export interface Validator {
    /** Unique identifier for this rule (e.g., "schema/step-id") */
    readonly id: string;
    /** Human-readable name */
    readonly name: string;
    /** Which phase this validator runs in */
    readonly phase: ValidationPhase;
    /** Run validation, adding issues to context. Can be async for file I/O operations. */
    validate(context: ValidationContext): void | Promise<void>;
}

/**
 * Registry for validators within a single phase
 */
class PhaseRegistry {
    private readonly validators: Validator[] = [];

    constructor(public readonly phase: ValidationPhase) {}

    /**
     * Add a validator to this phase
     */
    add(validator: Validator): void {
        if (validator.phase !== this.phase) {
            throw new Error(
                `Validator '${validator.id}' has phase '${validator.phase}' but was added to '${this.phase}' registry`
            );
        }
        this.validators.push(validator);
    }

    /**
     * Get all validators in registration order
     */
    getAll(): readonly Validator[] {
        return this.validators;
    }

    /**
     * Get validator count
     */
    get count(): number {
        return this.validators.length;
    }
}

/**
 * Multi-phase validation engine
 *
 * Executes validators in phases, providing:
 * - Phase ordering (schema → semantic → template → security)
 * - Shared context across all validators
 * - Fail-fast support for early termination
 * - Configurable phase selection
 */
export class ValidationEngine {
    private readonly registries: Map<ValidationPhase, PhaseRegistry>;

    constructor() {
        this.registries = new Map();
        for (const phase of VALIDATION_PHASES) {
            this.registries.set(phase, new PhaseRegistry(phase));
        }
    }

    /**
     * Register a validator for its declared phase
     */
    register(validator: Validator): this {
        const registry = this.registries.get(validator.phase);
        if (!registry) {
            throw new Error(`Unknown validation phase: ${validator.phase}`);
        }
        registry.add(validator);
        return this;
    }

    /**
     * Register multiple validators
     */
    registerAll(validators: Validator[]): this {
        for (const validator of validators) {
            this.register(validator);
        }
        return this;
    }

    /**
     * Validate a skill through all (or selected) phases.
     *
     * Note: Raw YAML validation (structure, types, unknown keys) is handled
     * by Zod in parseSkillFromContent(). This engine runs semantic validation
     * on the already-parsed skill object.
     *
     * Supports async validators for file I/O operations.
     *
     * @param skill - The skill to validate
     * @param options - Validation options
     * @returns Promise resolving to validation result with all issues found
     */
    async validate(skill: Skill, options: ValidationOptions = {}): Promise<ValidationResult> {
        const startTime = Date.now();
        const phasesToRun = options.phases ?? [...VALIDATION_PHASES];

        // Create shared context for validators
        const context = new ValidationContext(skill, {
            validateStepFiles: true,
            ...options
        });

        // Run each phase in order
        for (const phase of VALIDATION_PHASES) {
            // Skip phases not in the run list
            if (!phasesToRun.includes(phase)) continue;

            const registry = this.registries.get(phase);
            if (!registry || registry.count === 0) continue;

            // Run all validators in this phase
            for (const validator of registry.getAll()) {
                try {
                    // Support both sync and async validators
                    await validator.validate(context);
                } catch (error) {
                    // Validator threw an exception - add as error
                    context.addError(
                        validator.id,
                        phase,
                        'structure',
                        `Validator crashed: ${error instanceof Error ? error.message : String(error)}`
                    );
                }

                // Fail fast if requested and we have errors
                if (options.failFast && context.hasErrors()) {
                    break;
                }
            }

            // Stop phases if fail-fast triggered
            if (options.failFast && context.hasErrors()) {
                break;
            }
        }

        return context.buildResult(phasesToRun, Date.now() - startTime);
    }

    /**
     * Get validator count for a phase
     */
    getValidatorCount(phase: ValidationPhase): number {
        return this.registries.get(phase)?.count ?? 0;
    }

    /**
     * Get total validator count across all phases
     */
    getTotalValidatorCount(): number {
        let total = 0;
        for (const registry of this.registries.values()) {
            total += registry.count;
        }
        return total;
    }
}

/**
 * Abstract base class for validators with common utilities
 */
export abstract class BaseValidator implements Validator {
    abstract readonly id: string;
    abstract readonly name: string;
    abstract readonly phase: ValidationPhase;
    abstract validate(context: ValidationContext): void | Promise<void>;

    /**
     * Helper: Create field location for a step
     */
    protected stepLocation(stepIndex: number, field?: string): { field: string } {
        return { field: field ? `steps[${stepIndex}].${field}` : `steps[${stepIndex}]` };
    }

    /**
     * Helper: Create field location for an input
     */
    protected inputLocation(inputIndex: number, field?: string): { field: string } {
        return { field: field ? `inputs[${inputIndex}].${field}` : `inputs[${inputIndex}]` };
    }
}
