/**
 * Template Phase Validators
 *
 * Validates template interpolation and cross-file references:
 * - Variable existence in templates
 * - Output ordering (using outputs before they're defined)
 * - Condition syntax validation
 * - Params interpolation validation
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { SkillStep } from '../../types';
import type { ValidationPhase, VariableScope } from '../types';
import { BaseValidator } from '../engine';
import type { ValidationContext } from '../context';
import { extractExternalVariables, tryCompileCondition } from '../../interpolation';

const PHASE: ValidationPhase = 'template';

// ============================================================================
// Variable Existence Validator
// ============================================================================

/**
 * Validates that template variables reference existing inputs/outputs
 */
export class VariableExistenceValidator extends BaseValidator {
    readonly id = 'template/variable-existence';
    readonly name = 'Variable Existence Validator';
    readonly phase = PHASE;

    async validate(ctx: ValidationContext): Promise<void> {
        // Skip if step file validation is disabled
        if (!ctx.options.validateStepFiles) return;

        // Validate all step files in parallel for better performance
        const validations: Promise<void>[] = [];

        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];

            // Validate step file template variables
            if (step.file) {
                validations.push(this.validateStepFile(ctx, step, i));
            }

            // Validate message template (for confirmation steps with inline message)
            if (step.message) {
                this.validateMessage(ctx, step, i);
            }
        }

        await Promise.all(validations);
    }

    /**
     * Validate step file template variables.
     * Uses vscode.workspace.fs for remote/virtual filesystem compatibility.
     */
    private async validateStepFile(ctx: ValidationContext, step: SkillStep, stepIndex: number): Promise<void> {
        const stepUri = vscode.Uri.file(path.join(ctx.skill.source.path, step.file!));

        try {
            const contentBytes = await vscode.workspace.fs.readFile(stepUri);
            const content = new TextDecoder('utf-8').decode(contentBytes);
            this.validateTemplateVariables(ctx, content, step.file!, stepIndex);
        } catch {
            // File doesn't exist or read error - skip validation (schema validator handles this)
        }
    }

    private validateMessage(ctx: ValidationContext, step: SkillStep, stepIndex: number): void {
        if (!step.message) return;
        this.validateTemplateVariables(ctx, step.message, `steps[${stepIndex}].message`, stepIndex);
    }

    private validateTemplateVariables(
        ctx: ValidationContext,
        content: string,
        location: string,
        stepIndex: number
    ): void {
        // External variable references only; template-local vars ({% for %}/{% assign %}/
        // {% capture %}) are excluded by the static analyzer.
        const variables = extractExternalVariables(content);

        const scope = ctx.getVariableScopeAt(stepIndex);

        for (const varPath of variables) {
            if (!ctx.isVariableInScope(varPath, scope)) {
                const suggestion = this.getSuggestion(varPath, scope, ctx, stepIndex);
                ctx.addError(
                    this.id,
                    this.phase,
                    'reference',
                    `Template variable '${varPath}' is not available at step '${ctx.skill.steps[stepIndex].id}'`,
                    { file: location, field: varPath },
                    suggestion
                );
            }
        }
    }

    private getSuggestion(
        varPath: string,
        scope: VariableScope,
        ctx: ValidationContext,
        stepIndex: number
    ): string {
        const parts = varPath.split('.');
        const root = parts[0];

        // Check if it's an output that will exist later
        const outputDefIndex = ctx.getOutputDefinitionIndex(root);
        if (outputDefIndex >= 0 && outputDefIndex >= stepIndex) {
            const defStep = ctx.skill.steps[outputDefIndex];
            return `Output '${root}' is defined in step '${defStep.id}' which executes after this step. Move this step after '${defStep.id}'.`;
        }

        // Check for outputs namespace access to future output
        if (root === 'outputs' && parts.length > 1) {
            const outputName = parts[1];
            const outputDefIdx = ctx.getOutputDefinitionIndex(outputName);
            if (outputDefIdx >= 0 && outputDefIdx >= stepIndex) {
                const defStep = ctx.skill.steps[outputDefIdx];
                return `Output '${outputName}' is defined in step '${defStep.id}' which executes after this step.`;
            }
        }

        // Suggest similar variable names
        const allVars = [...scope.inputs, ...scope.outputs];
        const similar = ctx.findSimilar(root, allVars);

        if (similar.length > 0) {
            return `Did you mean: ${similar.join(', ')}?`;
        }

        const availableInputs = [...scope.inputs].join(', ') || '(none)';
        const availableOutputs = [...scope.outputs].join(', ') || '(none)';
        return `Available inputs: ${availableInputs}. Available outputs: ${availableOutputs}.`;
    }
}

// ============================================================================
// Output Ordering Validator
// ============================================================================

/**
 * Validates outputs are not referenced before they're defined
 */
export class OutputOrderingValidator extends BaseValidator {
    readonly id = 'template/output-ordering';
    readonly name = 'Output Ordering Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        // This is partially covered by VariableExistenceValidator
        // but this adds specific output-related checks

        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];
            if (!step.output) continue;

            // Check if this step references its own output in condition
            if (step.when && step.when.includes(step.output)) {
                ctx.addError(
                    this.id,
                    this.phase,
                    'reference',
                    `Step '${step.id}' condition references its own output '${step.output}' before it's assigned`,
                    this.stepLocation(i, 'when'),
                    'Remove the self-reference or use a different condition'
                );
            }
        }

        // Check output summary template
        if (ctx.skill.output?.summary) {
            const summaryTemplate = ctx.skill.output.summary;
            // External variable references only (loop/assign locals excluded).
            const variables = extractExternalVariables(summaryTemplate);

            const lastStepIndex = ctx.skill.steps.length - 1;
            const scope = ctx.getVariableScopeAt(lastStepIndex + 1); // After all steps

            // Build complete scope (all outputs available)
            const completeScope: VariableScope = {
                inputs: scope.inputs,
                outputs: new Set([...scope.outputs, ...ctx.outputNames]),
                builtins: scope.builtins
            };

            for (const varPath of variables) {
                if (!ctx.isVariableInScope(varPath, completeScope)) {
                    const similar = ctx.findSimilar(varPath.split('.')[0], [...completeScope.inputs, ...completeScope.outputs]);
                    ctx.addError(
                        this.id,
                        this.phase,
                        'reference',
                        `Output summary references undefined variable '${varPath}'`,
                        { field: 'output.summary' },
                        similar.length > 0 ? `Did you mean: ${similar.join(', ')}?` : undefined
                    );
                }
            }
        }
    }
}

// ============================================================================
// Condition Syntax Validator
// ============================================================================

/**
 * Validates conditional expression syntax (when clauses)
 */
export class ConditionSyntaxValidator extends BaseValidator {
    readonly id = 'template/condition-syntax';
    readonly name = 'Condition Syntax Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];
            if (!step.when) continue;

            this.validateCondition(ctx, step.when, step.id, i);
        }
    }

    private validateCondition(
        ctx: ValidationContext,
        condition: string,
        stepId: string,
        stepIndex: number
    ): void {
        const trimmed = condition.trim();

        // Check for empty condition
        if (trimmed === '') {
            ctx.addWarning(
                this.id,
                this.phase,
                'structure',
                `Step '${stepId}' has empty 'when' condition - will always evaluate to false`,
                this.stepLocation(stepIndex, 'when'),
                'Remove the when clause or add a valid condition'
            );
            return;
        }

        // Check for unbalanced brackets
        const openBraces = (trimmed.match(/\{\{/g) || []).length;
        const closeBraces = (trimmed.match(/\}\}/g) || []).length;
        if (openBraces !== closeBraces) {
            ctx.addError(
                this.id,
                this.phase,
                'structure',
                `Step '${stepId}' has unbalanced braces in condition: ${openBraces} '{{' vs ${closeBraces} '}}'`,
                this.stepLocation(stepIndex, 'when'),
                'Ensure all {{ have matching }}'
            );
        }

        // Check for Liquid tag syntax issues
        const openTags = (trimmed.match(/\{%/g) || []).length;
        const closeTags = (trimmed.match(/%\}/g) || []).length;
        if (openTags !== closeTags) {
            ctx.addError(
                this.id,
                this.phase,
                'structure',
                `Step '${stepId}' has unbalanced Liquid tags in condition: ${openTags} '{%' vs ${closeTags} '%}'`,
                this.stepLocation(stepIndex, 'when'),
                'Ensure all {% have matching %}'
            );
        }

        // Check for common mistakes
        if (trimmed.includes('===')) {
            ctx.addWarning(
                this.id,
                this.phase,
                'structure',
                `Step '${stepId}' condition uses '===' - Liquid uses '==' for equality`,
                this.stepLocation(stepIndex, 'when'),
                "Replace '===' with '=='"
            );
        }

        if (trimmed.includes('!==')) {
            ctx.addWarning(
                this.id,
                this.phase,
                'structure',
                `Step '${stepId}' condition uses '!==' - Liquid uses '!=' for inequality`,
                this.stepLocation(stepIndex, 'when'),
                "Replace '!==' with '!='"
            );
        }

        if (trimmed.includes('&&')) {
            ctx.addWarning(
                this.id,
                this.phase,
                'structure',
                `Step '${stepId}' condition uses '&&' - Liquid uses 'and' for logical AND`,
                this.stepLocation(stepIndex, 'when'),
                "Replace '&&' with 'and'"
            );
        }

        if (trimmed.includes('||')) {
            ctx.addWarning(
                this.id,
                this.phase,
                'structure',
                `Step '${stepId}' condition uses '||' - Liquid uses 'or' for logical OR`,
                this.stepLocation(stepIndex, 'when'),
                "Replace '||' with 'or'"
            );
        }

        // Parse-check with the SAME Liquid engine the runtime uses, so a condition
        // that would silently evaluate to false (parse error swallowed at runtime)
        // is surfaced at author time. Skip when JS-operator mistakes are present
        // (they have dedicated warnings above) or braces are unbalanced (already
        // errored) to avoid confusing duplicate errors.
        const hasJsOperatorMistake = /===|!==|&&|\|\|/.test(trimmed);
        const balanced = openBraces === closeBraces && openTags === closeTags;
        if (!hasJsOperatorMistake && balanced) {
            const parseError = tryCompileCondition(trimmed);
            if (parseError) {
                ctx.addError(
                    this.id,
                    this.phase,
                    'structure',
                    `Step '${stepId}' has an invalid 'when' condition that would always evaluate to false: ${parseError}`,
                    this.stepLocation(stepIndex, 'when'),
                    'Fix the condition syntax (see https://liquidjs.com for supported expressions)'
                );
            }
        }
    }
}

// ============================================================================
// Params Interpolation Validator
// ============================================================================

/**
 * Validates params object template variables for tool steps
 */
export class ParamsInterpolationValidator extends BaseValidator {
    readonly id = 'template/params-interpolation';
    readonly name = 'Params Interpolation Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];
            if (!step.params) continue;

            this.validateParams(ctx, step.params, step.id, i);
        }
    }

    private validateParams(
        ctx: ValidationContext,
        params: Record<string, unknown>,
        stepId: string,
        stepIndex: number
    ): void {
        const scope = ctx.getVariableScopeAt(stepIndex);

        // Recursively check all string values in params
        this.validateValue(ctx, params, '', stepId, stepIndex, scope);
    }

    private validateValue(
        ctx: ValidationContext,
        value: unknown,
        path: string,
        stepId: string,
        stepIndex: number,
        scope: VariableScope
    ): void {
        if (typeof value === 'string') {
            const variables = extractExternalVariables(value);
            for (const varPath of variables) {
                if (!ctx.isVariableInScope(varPath, scope)) {
                    ctx.addError(
                        this.id,
                        this.phase,
                        'reference',
                        `Step '${stepId}' params${path ? '.' + path : ''} references undefined variable '${varPath}'`,
                        this.stepLocation(stepIndex, `params${path ? '.' + path : ''}`),
                        this.getSuggestion(varPath, scope, ctx)
                    );
                }
            }
        } else if (Array.isArray(value)) {
            value.forEach((item, index) => {
                this.validateValue(ctx, item, `${path}[${index}]`, stepId, stepIndex, scope);
            });
        } else if (typeof value === 'object' && value !== null) {
            for (const [key, val] of Object.entries(value)) {
                this.validateValue(ctx, val, path ? `${path}.${key}` : key, stepId, stepIndex, scope);
            }
        }
    }

    private getSuggestion(varPath: string, scope: VariableScope, ctx: ValidationContext): string {
        const root = varPath.split('.')[0];
        const allVars = [...scope.inputs, ...scope.outputs];
        const similar = ctx.findSimilar(root, allVars);

        if (similar.length > 0) {
            return `Did you mean: ${similar.join(', ')}?`;
        }

        return `Available: ${allVars.join(', ') || '(none)'}`;
    }
}

// ============================================================================
// Export All Template Validators
// ============================================================================

export const templateValidators = [
    new VariableExistenceValidator(),
    new OutputOrderingValidator(),
    new ConditionSyntaxValidator(),
    new ParamsInterpolationValidator()
];
