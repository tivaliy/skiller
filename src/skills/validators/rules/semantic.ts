/**
 * Semantic Phase Validators
 *
 * Validates execution flow and logical correctness:
 * - Circular references in requires and goto
 * - Execution flow ordering
 * - Unreachable steps detection
 * - Confirmation step paths
 */

import type { SkillStep, ConfirmationOption } from '../../types';
import type { ValidationPhase } from '../types';
import { BaseValidator } from '../engine';
import type { ValidationContext } from '../context';

const PHASE: ValidationPhase = 'semantic';

// ============================================================================
// Circular References Validator
// ============================================================================

/**
 * Detects circular references in requires dependencies and goto references
 */
export class CircularReferencesValidator extends BaseValidator {
    readonly id = 'semantic/circular-references';
    readonly name = 'Circular References Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        // Build adjacency maps for both reference types
        const requiresGraph = new Map<string, string[]>();
        const gotoGraph = new Map<string, string[]>();

        for (const step of ctx.skill.steps) {
            // Build requires graph
            if (step.requires && step.requires.length > 0) {
                requiresGraph.set(step.id, [...step.requires]);
            }

            // Build goto graph from confirmation options
            if (step.options) {
                const gotoTargets: string[] = [];
                for (const option of step.options) {
                    if (option.action === 'goto' && option.gotoStep) {
                        gotoTargets.push(option.gotoStep);
                    }
                }
                if (gotoTargets.length > 0) {
                    gotoGraph.set(step.id, gotoTargets);
                }
            }
        }

        // Detect cycles in requires graph (ERROR - breaks execution order)
        const requiresCycles = this.detectCycles(requiresGraph);
        for (const cycle of requiresCycles) {
            ctx.addError(
                this.id,
                this.phase,
                'flow',
                `Circular dependency in 'requires': ${cycle.join(' → ')} → ${cycle[0]}`,
                { field: 'steps' },
                'Remove one of the dependencies to break the cycle'
            );
        }

        // Detect cycles in goto graph (WARNING - may be intentional retry loops)
        // Skip single-node cycles (self-loops) - ConfirmationPathsValidator handles those
        // with more context (includes the option label that causes the self-loop)
        const gotoCycles = this.detectCycles(gotoGraph).filter(cycle => cycle.length > 1);
        for (const cycle of gotoCycles) {
            ctx.addWarning(
                this.id,
                this.phase,
                'flow',
                `Circular 'goto' reference: ${cycle.join(' → ')} → ${cycle[0]}. This may cause infinite loops if not handled properly.`,
                { field: 'steps' },
                'Consider adding a condition or counter to prevent infinite loops'
            );
        }
    }

    /**
     * Detect all cycles in a directed graph using DFS
     */
    private detectCycles(graph: Map<string, string[]>): string[][] {
        const cycles: string[][] = [];
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const path: string[] = [];

        const dfs = (node: string): void => {
            if (visited.has(node)) return;

            if (recursionStack.has(node)) {
                // Cycle detected - extract the cycle from path
                const cycleStartIndex = path.indexOf(node);
                if (cycleStartIndex !== -1) {
                    const cycle = path.slice(cycleStartIndex);
                    // Deduplicate cycles (same cycle starting from different nodes)
                    const cycleKey = [...cycle].sort().join(',');
                    const existingCycle = cycles.find(c =>
                        [...c].sort().join(',') === cycleKey
                    );
                    if (!existingCycle) {
                        cycles.push(cycle);
                    }
                }
                return;
            }

            recursionStack.add(node);
            path.push(node);

            const neighbors = graph.get(node) || [];
            for (const neighbor of neighbors) {
                dfs(neighbor);
            }

            path.pop();
            recursionStack.delete(node);
            visited.add(node);
        };

        // Run DFS from all nodes to catch disconnected cycles
        for (const node of graph.keys()) {
            if (!visited.has(node)) {
                dfs(node);
            }
        }

        return cycles;
    }
}

// ============================================================================
// Requires Ordering Validator
// ============================================================================

/**
 * Validates that 'requires' dependencies reference steps that execute earlier
 */
export class RequiresOrderingValidator extends BaseValidator {
    readonly id = 'semantic/requires-ordering';
    readonly name = 'Requires Ordering Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];
            if (!step.requires || step.requires.length === 0) continue;

            for (const requiredId of step.requires) {
                // Check if required step exists
                if (!ctx.stepIds.has(requiredId)) {
                    const similar = ctx.findSimilar(requiredId, ctx.stepIds);
                    ctx.addError(
                        this.id,
                        this.phase,
                        'reference',
                        `Step '${step.id}' requires unknown step '${requiredId}'`,
                        this.stepLocation(i, 'requires'),
                        similar.length > 0 ? `Did you mean: ${similar.join(', ')}?` : undefined
                    );
                    continue;
                }

                // Check if required step comes before this step
                const requiredIndex = ctx.getStepIndex(requiredId);
                if (requiredIndex >= i) {
                    ctx.addError(
                        this.id,
                        this.phase,
                        'flow',
                        `Step '${step.id}' requires '${requiredId}' which executes later (at index ${requiredIndex})`,
                        this.stepLocation(i, 'requires'),
                        'Steps can only require steps that execute before them. Reorder the steps or remove the dependency.'
                    );
                }
            }
        }
    }
}

// ============================================================================
// Unreachable Steps Validator
// ============================================================================

/**
 * Detects steps that can never be executed due to conditions
 */
export class UnreachableStepsValidator extends BaseValidator {
    readonly id = 'semantic/unreachable-steps';
    readonly name = 'Unreachable Steps Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        // Track steps that always skip
        const alwaysSkips = new Set<string>();

        // First pass: identify steps with literal false conditions
        for (const step of ctx.skill.steps) {
            if (step.when) {
                const condition = step.when.trim().toLowerCase();
                // Detect always-false conditions
                if (condition === 'false' || condition === '0' || condition === '""' || condition === "''") {
                    alwaysSkips.add(step.id);
                    ctx.addWarning(
                        this.id,
                        this.phase,
                        'flow',
                        `Step '${step.id}' has condition '${step.when}' which is always false - step will never execute`,
                        { field: `steps[${ctx.getStepIndex(step.id)}].when` },
                        'Remove the step or fix the condition'
                    );
                }
            }
        }

        // Second pass: identify steps that depend only on always-skipped steps
        for (const step of ctx.skill.steps) {
            if (alwaysSkips.has(step.id)) continue;
            if (!step.requires || step.requires.length === 0) continue;

            // Check if all required steps always skip
            const allRequiredSkip = step.requires.every(reqId => alwaysSkips.has(reqId));
            if (allRequiredSkip) {
                ctx.addWarning(
                    this.id,
                    this.phase,
                    'flow',
                    `Step '${step.id}' requires only steps that never execute - this step may also never run as expected`,
                    { field: `steps[${ctx.getStepIndex(step.id)}].requires` }
                );
            }
        }

        // Third pass: identify steps that depend on outputs from always-skipped steps
        for (const step of ctx.skill.steps) {
            if (alwaysSkips.has(step.id)) continue;
            if (!step.when) continue;

            // Simple check: if condition references output from always-skipped step
            for (const skippedId of alwaysSkips) {
                const skippedStep = ctx.skill.steps.find(s => s.id === skippedId);
                if (skippedStep?.output && step.when.includes(skippedStep.output)) {
                    ctx.addWarning(
                        this.id,
                        this.phase,
                        'flow',
                        `Step '${step.id}' condition references '${skippedStep.output}' which is defined by step '${skippedId}' that never executes`,
                        { field: `steps[${ctx.getStepIndex(step.id)}].when` }
                    );
                }
            }
        }
    }
}

// ============================================================================
// Confirmation Paths Validator
// ============================================================================

/**
 * Validates confirmation steps have valid execution paths
 */
export class ConfirmationPathsValidator extends BaseValidator {
    readonly id = 'semantic/confirmation-paths';
    readonly name = 'Confirmation Paths Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];
            if (step.type !== 'confirmation') continue;

            this.validateConfirmationPaths(ctx, step, i);
        }
    }

    private validateConfirmationPaths(ctx: ValidationContext, step: SkillStep, index: number): void {
        const options = step.options || [];

        // If no options defined, defaults will be provided (Continue/Cancel)
        if (options.length === 0) return;

        // Check if there's at least one way to continue
        const hasContinuePath = options.some(opt =>
            opt.action === 'continue' || opt.action === 'goto'
        );

        if (!hasContinuePath) {
            // Guard pattern: if step has a 'when' condition, the workflow can continue
            // by skipping the step entirely when the condition is false.
            // This is a valid pattern for prerequisite checks that should abort if unmet.
            if (step.when) {
                return; // Valid guard pattern, no error needed
            }

            ctx.addError(
                this.id,
                this.phase,
                'flow',
                `Confirmation step '${step.id}' has no way to continue - all options abort`,
                this.stepLocation(index, 'options'),
                "Add an option with action 'continue' or 'goto', or add a 'when' condition to make this a guard step"
            );
        }

        // Check if goto targets are valid
        for (const option of options) {
            if (option.action === 'goto' && option.gotoStep) {
                const targetIndex = ctx.getStepIndex(option.gotoStep);

                // Check for self-reference (goto points to same step)
                if (targetIndex === index) {
                    ctx.addWarning(
                        this.id,
                        this.phase,
                        'flow',
                        `Step '${step.id}' option '${option.label}' creates a self-loop (gotoStep points to itself)`,
                        { field: `steps[${index}].options` },
                        'Self-loops can cause infinite loops if the user keeps selecting this option. Consider if this is intentional.'
                    );
                }
                // Check for backward jumps (goto to earlier step)
                else if (targetIndex !== -1 && targetIndex < index) {
                    // Jumping backward - this could cause issues unless intentional retry
                    ctx.addWarning(
                        this.id,
                        this.phase,
                        'flow',
                        `Step '${step.id}' option '${option.label}' jumps backward to '${option.gotoStep}' - this may re-execute steps`,
                        { field: `steps[${index}].options` },
                        'This pattern can be useful for retries but may cause unexpected behavior'
                    );
                }
            }
        }

        // Check for duplicate labels
        const seenLabels = new Set<string>();
        for (const option of options) {
            if (seenLabels.has(option.label)) {
                ctx.addWarning(
                    this.id,
                    this.phase,
                    'structure',
                    `Confirmation step '${step.id}' has duplicate option label '${option.label}'`,
                    this.stepLocation(index, 'options'),
                    'Use unique labels to avoid user confusion'
                );
            }
            seenLabels.add(option.label);
        }
    }
}

// ============================================================================
// Execution Flow Validator
// ============================================================================

/**
 * Validates overall execution flow and step ordering
 */
export class ExecutionFlowValidator extends BaseValidator {
    readonly id = 'semantic/execution-flow';
    readonly name = 'Execution Flow Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        const steps = ctx.skill.steps;
        if (steps.length === 0) return;

        // Check that steps have meaningful IDs (not auto-generated)
        let autoGeneratedCount = 0;
        for (const step of steps) {
            if (/^step-\d+$/.test(step.id)) {
                autoGeneratedCount++;
            }
        }

        if (autoGeneratedCount === steps.length && steps.length > 1) {
            ctx.addInfo(
                this.id,
                this.phase,
                'structure',
                'All steps use auto-generated IDs - consider adding meaningful IDs for clarity',
                { field: 'steps' }
            );
        }

        // Check for confirmation step at the very end without meaningful options
        const lastStep = steps[steps.length - 1];
        if (lastStep.type === 'confirmation') {
            const options = lastStep.options || [];
            const onlyAbort = options.length > 0 && options.every(o => o.action === 'abort');

            if (onlyAbort) {
                ctx.addWarning(
                    this.id,
                    this.phase,
                    'flow',
                    `Last step '${lastStep.id}' is a confirmation with only abort options - skill cannot complete successfully`,
                    this.stepLocation(steps.length - 1, 'options'),
                    "Add a 'continue' option to allow the skill to complete"
                );
            }
        }

        // Check for very long step chains without confirmation checkpoints
        const MAX_STEPS_WITHOUT_CHECKPOINT = 10;
        let stepsWithoutCheckpoint = 0;

        for (const step of steps) {
            if (step.type === 'confirmation') {
                stepsWithoutCheckpoint = 0;
            } else {
                stepsWithoutCheckpoint++;
                if (stepsWithoutCheckpoint > MAX_STEPS_WITHOUT_CHECKPOINT) {
                    ctx.addInfo(
                        this.id,
                        this.phase,
                        'flow',
                        `Skill has ${stepsWithoutCheckpoint}+ consecutive steps without a confirmation checkpoint`,
                        { field: 'steps' }
                    );
                    break; // Only warn once
                }
            }
        }
    }
}

// ============================================================================
// Export All Semantic Validators
// ============================================================================

export const semanticValidators = [
    new CircularReferencesValidator(),
    new RequiresOrderingValidator(),
    new UnreachableStepsValidator(),
    new ConfirmationPathsValidator(),
    new ExecutionFlowValidator()
];
