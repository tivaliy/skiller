/**
 * Schema Phase Validators
 *
 * Validates skill structure after parsing. Focuses on semantic validation:
 * - Step ID format and uniqueness
 * - Input semantic validation (duplicates, type mismatches)
 * - Tool configuration (cross-field validation)
 * - Model configuration (circular aliases)
 * - Confirmation options (step references)
 * - Output variables (duplicates, shadowing)
 * - Step file existence (async I/O)
 */

import type { ValidationPhase } from '../types';
import { BaseValidator } from '../engine';
import type { ValidationContext } from '../context';

const PHASE: ValidationPhase = 'schema';

// ============================================================================
// Step ID Validator
// ============================================================================

/**
 * Reserved keywords that conflict with template context variables
 */
const RESERVED_KEYWORDS = new Set([
    'inputs', 'outputs', 'skill', 'currentStep', 'totalSteps',
    'startTime', 'stepTimes', 'availableMcps', 'workspaceFolder'
]);

/**
 * Validates step IDs for reserved keywords and naming conventions.
 */
export class StepIdValidator extends BaseValidator {
    readonly id = 'schema/step-id';
    readonly name = 'Step ID Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];
            const location = this.stepLocation(i, 'id');

            // Check for reserved keywords (can't be done in Zod - requires runtime context)
            if (RESERVED_KEYWORDS.has(step.id)) {
                ctx.addError(
                    this.id,
                    this.phase,
                    'reference',
                    `Step ID '${step.id}' conflicts with reserved keyword`,
                    location,
                    `Choose a different ID. Reserved: ${[...RESERVED_KEYWORDS].join(', ')}`
                );
            }

            // Check for dots (semantic warning - breaks output path access)
            if (step.id.includes('.')) {
                ctx.addWarning(
                    this.id,
                    this.phase,
                    'compatibility',
                    `Step ID '${step.id}' contains dots which may break output variable access`,
                    location,
                    'Use hyphens or underscores instead of dots'
                );
            }
        }
    }
}

// ============================================================================
// Input Definition Validator
// ============================================================================

/**
 * Validates semantic aspects of input definitions:
 * - Duplicate input names
 * - Default value type matching
 * - Semantic warnings (enum/pattern with non-string type)
 */
export class InputDefinitionValidator extends BaseValidator {
    readonly id = 'schema/input-definition';
    readonly name = 'Input Definition Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        for (let i = 0; i < ctx.skill.inputs.length; i++) {
            const input = ctx.skill.inputs[i];
            if (!input.name) continue;

            // Validate default value matches declared type (complex logic with coercion)
            if (input.default !== undefined) {
                this.validateDefaultType(ctx, input, i);
            }

            // Warn about enum with non-string type
            if (input.enum && input.enum.length > 0) {
                if (input.type !== 'string' && input.type !== undefined) {
                    ctx.addWarning(
                        this.id,
                        this.phase,
                        'type',
                        `Input '${input.name}' has enum but type is '${input.type}' (enum works best with string)`,
                        this.inputLocation(i, 'enum')
                    );
                }
            }

            // Warn about pattern with non-string type (semantic warning)
            if (input.pattern) {
                if (input.type !== 'string' && input.type !== undefined) {
                    ctx.addWarning(
                        this.id,
                        this.phase,
                        'type',
                        `Input '${input.name}' has pattern but type is '${input.type}' (pattern only works with string)`,
                        this.inputLocation(i, 'pattern')
                    );
                }
            }

            // Info: required + default (potentially confusing semantics)
            if (input.required && input.default !== undefined) {
                ctx.addInfo(
                    this.id,
                    this.phase,
                    'structure',
                    `Input '${input.name}' is required but has a default value - the default will be used if not provided`,
                    this.inputLocation(i)
                );
            }

            // Info: array type without element type
            if (input.type === 'array') {
                ctx.addInfo(
                    this.id,
                    this.phase,
                    'type',
                    `Input '${input.name}' is array type - element types are not validated at runtime`,
                    this.inputLocation(i, 'type')
                );
            }
        }
    }

    private validateDefaultType(ctx: ValidationContext, input: { name: string; type?: string; default?: unknown }, index: number): void {
        if (input.default === undefined) return;
        const actualType = Array.isArray(input.default) ? 'array' : typeof input.default;
        const expectedType = input.type || 'string';

        // Check type match
        if (actualType !== expectedType) {
            // Allow string-to-number coercion for number type
            if (expectedType === 'number' && typeof input.default === 'string') {
                if (isNaN(Number(input.default))) {
                    ctx.addError(
                        this.id,
                        this.phase,
                        'type',
                        `Input '${input.name}' has type '${expectedType}' but default value '${input.default}' cannot be converted to a number`,
                        this.inputLocation(index, 'default'),
                        'Provide a numeric default value'
                    );
                }
                return;
            }

            ctx.addError(
                this.id,
                this.phase,
                'type',
                `Input '${input.name}' has type '${expectedType}' but default value has type '${actualType}'`,
                this.inputLocation(index, 'default'),
                `Provide a default value of type '${expectedType}'`
            );
        }
    }
}

// ============================================================================
// Tool Configuration Validator
// ============================================================================

/**
 * Validates tool step configuration and tool-related properties
 */
export class ToolConfigurationValidator extends BaseValidator {
    readonly id = 'schema/tool-configuration';
    readonly name = 'Tool Configuration Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];
            if (step.type === 'llm') {
                this.validateLLMStepTools(ctx, step, i);
            } else if (step.type === 'tool') {
                this.validateToolStepReference(ctx, step, i);
            }
        }

        this.validateToolAliases(ctx);
    }

    /**
     * Validate a tool step's `tool:` reference (S-04).
     *
     * A value that matches a declared alias resolves through the skill's tool
     * contract. A value that doesn't will be resolved as a raw MCP tool name at
     * runtime — which is usually a typo of an alias. Warn (not error) so legit
     * raw-name usage still works, but surface a "did you mean" for near misses.
     */
    private validateToolStepReference(
        ctx: ValidationContext,
        step: { id: string; tool?: string },
        index: number
    ): void {
        if (!step.tool) return;

        const aliases = ctx.skill.tools.aliases ?? {};
        if (step.tool in aliases) return; // resolves through a declared alias — good

        const aliasNames = Object.keys(aliases);
        const similar = aliasNames.length > 0 ? ctx.findSimilar(step.tool, aliasNames) : [];
        if (similar.length > 0) {
            ctx.addWarning(
                this.id,
                this.phase,
                'reference',
                `Step '${step.id}': tool '${step.tool}' is not a declared alias and will be resolved as a raw MCP tool name`,
                this.stepLocation(index, 'tool'),
                `Did you mean a declared alias: ${similar.join(', ')}?`
            );
        }
    }

    private validateLLMStepTools(ctx: ValidationContext, step: { id: string; tools?: string[]; toolMode?: string }, index: number): void {
        // Warn about duplicate tools in tools array
        if (step.tools && step.tools.length > 0) {
            const seen = new Set<string>();
            for (const tool of step.tools) {
                if (seen.has(tool)) {
                    ctx.addWarning(
                        this.id,
                        this.phase,
                        'structure',
                        `Step '${step.id}' has duplicate tool '${tool}' in tools array`,
                        this.stepLocation(index, 'tools')
                    );
                }
                seen.add(tool);
            }
        }
    }

    private validateToolAliases(ctx: ValidationContext): void {
        const { aliases } = ctx.skill.tools;
        if (!aliases || Object.keys(aliases).length === 0) return;

        // Validate each alias
        for (const [aliasName, aliasValue] of Object.entries(aliases)) {
            // Check that ? is only at the end of the value
            const qIndex = aliasValue.indexOf('?');
            if (qIndex !== -1 && qIndex !== aliasValue.length - 1) {
                ctx.addError(
                    this.id,
                    this.phase,
                    'structure',
                    `Tool alias '${aliasName}' has invalid format: '?' marker must be at the end of the tool name`,
                    { field: `tools.aliases.${aliasName}` },
                    `Change '${aliasValue}' to '${aliasValue.replace(/\?/g, '')}?' or remove the '?' if the tool is required`
                );
            }

            // Check for empty tool name after stripping ?
            const toolName = aliasValue.endsWith('?') ? aliasValue.slice(0, -1) : aliasValue;
            if (!toolName || toolName.trim() === '') {
                ctx.addError(
                    this.id,
                    this.phase,
                    'structure',
                    `Tool alias '${aliasName}' has empty tool name`,
                    { field: `tools.aliases.${aliasName}` },
                    'Specify a valid MCP tool name'
                );
            }
        }

        // Check for circular aliases (after stripping ? suffix)
        const visited = new Set<string>();
        const resolving = new Set<string>();

        const getTargetAlias = (alias: string): string | undefined => {
            const value = aliases[alias];
            if (!value) return undefined;
            // Strip ? suffix when checking for circular references
            const target = value.endsWith('?') ? value.slice(0, -1) : value;
            return aliases[target] ? target : undefined;
        };

        const checkCircular = (alias: string, path: string[]): boolean => {
            if (resolving.has(alias)) {
                ctx.addError(
                    this.id,
                    this.phase,
                    'reference',
                    `Circular tool alias detected: ${path.join(' → ')} → ${alias}`,
                    { field: 'tools.aliases' },
                    'Remove the circular reference'
                );
                return true;
            }

            if (visited.has(alias)) return false;

            const target = getTargetAlias(alias);
            if (target) {
                resolving.add(alias);
                const result = checkCircular(target, [...path, alias]);
                resolving.delete(alias);
                if (result) return true;
            }

            visited.add(alias);
            return false;
        };

        for (const alias of Object.keys(aliases)) {
            checkCircular(alias, []);
        }
    }
}

// ============================================================================
// Model Configuration Validator
// ============================================================================

/**
 * Validates model configuration (aliases and defaults)
 */
export class ModelConfigurationValidator extends BaseValidator {
    readonly id = 'schema/model-configuration';
    readonly name = 'Model Configuration Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        const { models } = ctx.skill;
        if (!models) return;

        // Validate model aliases don't reference each other circularly
        if (models.aliases) {
            const visited = new Set<string>();
            const resolving = new Set<string>();

            const checkCircular = (alias: string, path: string[]): boolean => {
                if (resolving.has(alias)) {
                    ctx.addError(
                        this.id,
                        this.phase,
                        'reference',
                        `Circular model alias detected: ${path.join(' → ')} → ${alias}`,
                        { field: 'models.aliases' }
                    );
                    return true;
                }

                if (visited.has(alias)) return false;

                const target = models.aliases![alias];
                if (target && models.aliases![target]) {
                    resolving.add(alias);
                    const result = checkCircular(target, [...path, alias]);
                    resolving.delete(alias);
                    if (result) return true;
                }

                visited.add(alias);
                return false;
            };

            for (const alias of Object.keys(models.aliases)) {
                checkCircular(alias, []);
            }
        }

        // Validate step model references resolve
        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];
            if (!step.model) continue;

            // If step specifies a model, it should be either an alias or look like a model ID
            const isAlias = models.aliases && step.model in models.aliases;
            const looksLikeModelId = step.model.includes('-') || step.model.includes('/');

            if (!isAlias && !looksLikeModelId) {
                ctx.addWarning(
                    this.id,
                    this.phase,
                    'reference',
                    `Step '${step.id}' references model '${step.model}' which is not a defined alias and may not be a valid model ID`,
                    this.stepLocation(i, 'model'),
                    models.aliases
                        ? `Available aliases: ${Object.keys(models.aliases).join(', ')}`
                        : 'Define model aliases in the models.aliases section'
                );
            }
        }
    }
}

// ============================================================================
// Confirmation Options Validator
// ============================================================================

/**
 * Validates gotoStep references point to valid step IDs.
 */
export class ConfirmationOptionsValidator extends BaseValidator {
    readonly id = 'schema/confirmation-options';
    readonly name = 'Confirmation Options Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];

            // An explicitly empty options list leaves a confirmation with no
            // selectable choice — a permanently stuck step (S-10). Omitting
            // options entirely is fine (defaults to Continue/Cancel).
            if (step.type === 'confirmation' && Array.isArray(step.options) && step.options.length === 0) {
                ctx.addError(
                    this.id,
                    this.phase,
                    'structure',
                    `Confirmation step '${step.id}' has an empty options list, leaving no way to proceed`,
                    this.stepLocation(i, 'options'),
                    'Add at least one option, or omit "options" to get default Continue/Cancel choices'
                );
            }

            // Validate goto references in options
            if (step.options) {
                this.validateGotoReferences(ctx, step, i);
            }
        }
    }

    private validateGotoReferences(ctx: ValidationContext, step: { id: string; options?: Array<{ label: string; action: string; gotoStep?: string }> }, index: number): void {
        if (!step.options) return;

        for (let j = 0; j < step.options.length; j++) {
            const option = step.options[j];

            // Validate gotoStep references valid step ID (semantic check)
            if (option.gotoStep && !ctx.stepIds.has(option.gotoStep)) {
                const similar = ctx.findSimilar(option.gotoStep, ctx.stepIds);
                ctx.addError(
                    this.id,
                    this.phase,
                    'reference',
                    `Step '${step.id}': option '${option.label}' references unknown step '${option.gotoStep}'`,
                    { field: `steps[${index}].options[${j}].gotoStep` },
                    similar.length > 0 ? `Did you mean: ${similar.join(', ')}?` : undefined
                );
            }
        }
    }
}

// ============================================================================
// Output Variables Validator
// ============================================================================

/**
 * Validates output variable semantic constraints
 */
export class OutputVariablesValidator extends BaseValidator {
    readonly id = 'schema/output-variables';
    readonly name = 'Output Variables Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];
            if (!step.output) continue;

            // Check output name doesn't conflict with input names (cross-section warning)
            if (ctx.inputNames.has(step.output)) {
                ctx.addWarning(
                    this.id,
                    this.phase,
                    'reference',
                    `Output variable '${step.output}' in step '${step.id}' shadows an input with the same name`,
                    this.stepLocation(i, 'output'),
                    'Consider using a different output name to avoid confusion'
                );
            }
        }
    }
}

// ============================================================================
// Step Files Validator
// ============================================================================

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Validates step files exist and are accessible.
 * Uses vscode.workspace.fs for remote/virtual filesystem compatibility.
 */
export class StepFilesValidator extends BaseValidator {
    readonly id = 'schema/step-files';
    readonly name = 'Step Files Validator';
    readonly phase = PHASE;

    async validate(ctx: ValidationContext): Promise<void> {
        // Skip if step file validation is disabled
        if (!ctx.options.validateStepFiles) return;

        // Check all step files in parallel for better performance
        const checks: Promise<void>[] = [];

        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];

            // Confirmation steps can use inline message instead of file
            if (step.type === 'confirmation' && !step.file && step.message) {
                continue;
            }

            // Tool steps with params don't need a file (pure tool invocation)
            if (step.type === 'tool' && step.params && !step.file) {
                continue;
            }

            // LLM steps can use inline message instead of file
            if (step.type === 'llm' && !step.file && step.message) {
                continue;
            }

            if (step.file) {
                checks.push(this.checkStepFileExists(ctx, step.file, i));
            }
        }

        await Promise.all(checks);
    }

    private async checkStepFileExists(ctx: ValidationContext, file: string, stepIndex: number): Promise<void> {
        const stepPath = path.join(ctx.skill.source.path, file);
        const stepUri = vscode.Uri.file(stepPath);

        try {
            await vscode.workspace.fs.stat(stepUri);
        } catch {
            ctx.addError(
                this.id,
                this.phase,
                'structure',
                `Step file not found: ${file}`,
                { file: stepPath, field: `steps[${stepIndex}].file` },
                `Create the file at: ${file}`
            );
        }
    }
}

// ============================================================================
// Export All Schema Validators
// ============================================================================

/**
 * Schema phase validators for semantic checks:
 * - Reference validation (step IDs, gotoStep targets)
 * - Uniqueness checks (duplicate IDs, names, outputs)
 * - Cross-field validation (tool configuration, model aliases)
 * - File existence (async I/O)
 */
export const schemaValidators = [
    new StepIdValidator(),
    new InputDefinitionValidator(),
    new ToolConfigurationValidator(),
    new ModelConfigurationValidator(),
    new ConfirmationOptionsValidator(),
    new OutputVariablesValidator(),
    new StepFilesValidator()
];
