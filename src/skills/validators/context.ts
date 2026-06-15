/**
 * Validation Context
 *
 * Stateful accumulator for validation issues and computed state.
 * Passed to each validator, providing access to skill data and helper methods.
 *
 * Key responsibilities:
 * - Accumulate errors, warnings, and info messages
 * - Cache computed state (step IDs, variable scopes, etc.)
 * - Provide helper methods for common validation checks
 */

import type { Skill, SkillStep } from '../types';
import { findSimilarStrings } from '../utils';
import type {
    ValidationIssue,
    ValidationSeverity,
    ValidationPhase,
    ValidationCategory,
    ValidationLocation,
    ValidationOptions,
    ValidationResult,
    VariableScope
} from './types';

/**
 * Built-in variables always available in templates
 */
const BUILTIN_VARIABLES = new Set([
    'skill',
    'currentStep',
    'totalSteps',
    'startTime',
    'stepTimes',
    'availableMcps',
    'workspaceFolder'
]);

/**
 * Validation context - shared state across all validators
 */
export class ValidationContext {
    private readonly issues: ValidationIssue[] = [];

    // Cached computed state (lazy initialization)
    private _stepIds?: Set<string>;
    private _stepIdToIndex?: Map<string, number>;
    private _inputNames?: Set<string>;
    private _outputNames?: Map<string, number>; // output name → step index where defined
    private _variableScopes?: Map<number, VariableScope>;

    constructor(
        public readonly skill: Skill,
        public readonly options: ValidationOptions
    ) {}

    // ========================================================================
    // Issue Accumulation
    // ========================================================================

    /**
     * Add an error issue (blocks validation success)
     */
    addError(
        ruleId: string,
        phase: ValidationPhase,
        category: ValidationCategory,
        message: string,
        location?: ValidationLocation,
        suggestion?: string
    ): void {
        this.addIssue('error', ruleId, phase, category, message, location, suggestion);
    }

    /**
     * Add a warning issue (doesn't block validation)
     */
    addWarning(
        ruleId: string,
        phase: ValidationPhase,
        category: ValidationCategory,
        message: string,
        location?: ValidationLocation,
        suggestion?: string
    ): void {
        this.addIssue('warning', ruleId, phase, category, message, location, suggestion);
    }

    /**
     * Add an info issue (only included if options.includeInfo is true)
     */
    addInfo(
        ruleId: string,
        phase: ValidationPhase,
        category: ValidationCategory,
        message: string,
        location?: ValidationLocation
    ): void {
        if (this.options.includeInfo) {
            this.addIssue('info', ruleId, phase, category, message, location);
        }
    }

    private addIssue(
        severity: ValidationSeverity,
        ruleId: string,
        phase: ValidationPhase,
        category: ValidationCategory,
        message: string,
        location?: ValidationLocation,
        suggestion?: string
    ): void {
        this.issues.push({
            ruleId,
            severity,
            phase,
            category,
            message,
            location,
            suggestion
        });
    }

    /**
     * Check if any errors have been accumulated
     */
    hasErrors(): boolean {
        return this.issues.some(i => i.severity === 'error');
    }

    /**
     * Get all accumulated issues
     */
    getIssues(): readonly ValidationIssue[] {
        return this.issues;
    }

    // ========================================================================
    // Computed State (Cached for Performance)
    // ========================================================================

    /**
     * Get all step IDs as a Set
     */
    get stepIds(): Set<string> {
        if (!this._stepIds) {
            this._stepIds = new Set(this.skill.steps.map(s => s.id));
        }
        return this._stepIds;
    }

    /**
     * Get step ID to index mapping
     */
    get stepIdToIndex(): Map<string, number> {
        if (!this._stepIdToIndex) {
            this._stepIdToIndex = new Map();
            this.skill.steps.forEach((s, i) => this._stepIdToIndex!.set(s.id, i));
        }
        return this._stepIdToIndex;
    }

    /**
     * Get all input names as a Set
     */
    get inputNames(): Set<string> {
        if (!this._inputNames) {
            this._inputNames = new Set(this.skill.inputs.map(i => i.name));
        }
        return this._inputNames;
    }

    /**
     * Get output names with the step index where they're defined
     */
    get outputDefinitions(): Map<string, number> {
        if (!this._outputNames) {
            this._outputNames = new Map();
            this.skill.steps.forEach((s, i) => {
                if (s.output) {
                    this._outputNames!.set(s.output, i);
                }
            });
        }
        return this._outputNames;
    }

    /**
     * Get all output variable names as a Set
     */
    get outputNames(): Set<string> {
        return new Set(this.outputDefinitions.keys());
    }

    /**
     * Get step index by ID (returns -1 if not found)
     */
    getStepIndex(stepId: string): number {
        return this.stepIdToIndex.get(stepId) ?? -1;
    }

    /**
     * Get variable scope at a specific step index
     * Returns which variables are available for interpolation at that step
     */
    getVariableScopeAt(stepIndex: number): VariableScope {
        if (!this._variableScopes) {
            this._variableScopes = this.computeVariableScopes();
        }
        return this._variableScopes.get(stepIndex) ?? {
            inputs: new Set(this.inputNames),
            outputs: new Set(),
            builtins: BUILTIN_VARIABLES
        };
    }

    /**
     * Check if a variable path is in the given scope
     */
    isVariableInScope(varPath: string, scope: VariableScope): boolean {
        const parts = varPath.split('.');
        const root = parts[0];

        // Check explicit namespace access
        if (root === 'inputs') {
            const inputName = parts[1];
            return inputName ? scope.inputs.has(inputName) : true;
        }

        if (root === 'outputs') {
            const outputName = parts[1];
            return outputName ? scope.outputs.has(outputName) : true;
        }

        // Check direct access (input or output name at root)
        if (scope.inputs.has(root) || scope.outputs.has(root)) {
            return true;
        }

        // Check built-in variables
        return scope.builtins.has(root);
    }

    /**
     * Get index where an output is defined (returns -1 if not found)
     */
    getOutputDefinitionIndex(outputName: string): number {
        return this.outputDefinitions.get(outputName) ?? -1;
    }

    /**
     * Compute variable scopes for each step
     */
    private computeVariableScopes(): Map<number, VariableScope> {
        const scopes = new Map<number, VariableScope>();
        const availableOutputs = new Set<string>();

        // Pass 1 — linear scope: each step sees all inputs plus the outputs of
        // the steps that precede it in document order.
        for (let i = 0; i < this.skill.steps.length; i++) {
            const step = this.skill.steps[i];

            // Scope at this step = all inputs + outputs from previous steps
            scopes.set(i, {
                inputs: new Set(this.inputNames),
                outputs: new Set(availableOutputs),
                builtins: BUILTIN_VARIABLES
            });

            // After this step, its output becomes available for future steps
            if (step.output) {
                availableOutputs.add(step.output);
            }
        }

        // Pass 2 — loop-carried scope: a backward `goto` (a confirmation option
        // that jumps to an earlier-or-equal step) forms a loop. On every iteration
        // after the first, each step in the loop body has already seen the outputs
        // of all other body steps, so referencing them is legitimate (authors guard
        // the first pass with `{% if %}`). Without this, any stateful loop trips
        // variable-existence — even though `goto` loops are a first-class feature.
        this.addLoopCarriedOutputs(scopes);

        return scopes;
    }

    /**
     * Widen scopes to include outputs produced anywhere inside a `goto` loop body.
     *
     * For each backward edge (a confirmation option whose target step index is ≤
     * its own step index), the body is the inclusive range [target, source]; every
     * output defined in that range becomes available to every step in it.
     */
    private addLoopCarriedOutputs(scopes: Map<number, VariableScope>): void {
        for (let source = 0; source < this.skill.steps.length; source++) {
            const options = this.skill.steps[source].options;
            if (!options) continue;

            for (const option of options) {
                if (option.action !== 'goto' || !option.gotoStep) continue;
                const target = this.getStepIndex(option.gotoStep);
                // Unknown target or a forward jump is not a loop back-edge.
                if (target < 0 || target > source) continue;

                // Outputs produced anywhere in the loop body [target, source]...
                const loopOutputs: string[] = [];
                for (let i = target; i <= source; i++) {
                    const out = this.skill.steps[i].output;
                    if (out) loopOutputs.push(out);
                }
                // ...become available to every step in that body.
                for (let i = target; i <= source; i++) {
                    const scope = scopes.get(i);
                    if (!scope) continue;
                    for (const out of loopOutputs) scope.outputs.add(out);
                }
            }
        }
    }

    // ========================================================================
    // Result Building
    // ========================================================================

    /**
     * Build the final validation result
     */
    buildResult(phasesRun: ValidationPhase[], duration: number): ValidationResult {
        const errors = this.issues.filter(i => i.severity === 'error');
        const warnings = this.issues.filter(i => i.severity === 'warning');

        return {
            valid: errors.length === 0,
            issues: [...this.issues],
            errors,
            warnings,
            phasesRun,
            duration
        };
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Find similar strings for typo suggestions (delegates to shared utility)
     */
    findSimilar(target: string, candidates: Iterable<string>, maxDistance: number = 2): string[] {
        return findSimilarStrings(target, candidates, maxDistance);
    }
}
