/**
 * Skill Graph Builder
 *
 * Converts a Skill definition into an intermediate SkillGraph representation.
 * This graph can then be rendered to various formats (Mermaid, ASCII, SVG, etc.)
 */

import type { Skill, SkillStep, SkillModels } from '../types';
import type { SkillGraph, GraphNode, GraphEdge, NodeType, ConfigModelSource } from './types';
import { formatCondition } from './formatting';

/**
 * Builds a SkillGraph from a Skill definition
 */
export class SkillGraphBuilder {
    /**
     * Build a graph representation from a skill
     */
    build(skill: Skill): SkillGraph {
        const nodes = this.buildNodes(skill.steps, skill.models);
        const edges = this.buildEdges(skill.steps);

        return {
            title: skill.name,
            nodes,
            edges
        };
    }

    /**
     * Build graph nodes from skill steps
     *
     * Model inheritance logic:
     * - If step has explicit `model:`, use it with source 'explicit'
     * - If step is LLM type and skill has `models.default`, inherit it with source 'inherited'
     * - Otherwise, no model badge (will use VS Code auto at runtime)
     */
    private buildNodes(steps: SkillStep[], models?: SkillModels): GraphNode[] {
        return steps.map(step => {
            const nodeType = this.getNodeType(step);

            // Determine model and source
            let model: string | undefined;
            let modelSource: ConfigModelSource | undefined;

            if (step.model) {
                // Explicit step-level model configuration
                model = step.model;
                modelSource = 'explicit';
            } else if (nodeType === 'llm' && models?.default) {
                // LLM step inherits skill-level default
                model = models.default;
                modelSource = 'inherited';
            }
            // else: no model badge - will use VS Code auto at runtime

            return {
                id: step.id,
                label: step.description
                    ? `${step.id}: ${step.description}`
                    : step.id,
                type: nodeType,
                condition: step.when,
                tools: step.tools,
                tool: step.tool,
                model,
                modelSource
            };
        });
    }

    /**
     * Build graph edges from skill steps
     *
     * Handles:
     * - Sequential flow between steps
     * - Conditional guards (steps with `when` clauses that can be skipped)
     * - Confirmation steps with continue/abort/goto options
     */
    private buildEdges(steps: SkillStep[]): GraphEdge[] {
        const edges: GraphEdge[] = [];

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const nextStep = steps[i + 1];

            const addWhenBranchEdges = (fromStepId: string, guardedIndex: number, prefixLabel?: string) => {
                const guarded = steps[guardedIndex];
                if (!guarded?.when) return;

                const conditionLabel = formatCondition(guarded.when);
                const takenLabel = prefixLabel
                    ? `${prefixLabel}: if ${conditionLabel}`
                    : `if ${conditionLabel}`;
                edges.push({
                    from: fromStepId,
                    to: guarded.id,
                    type: 'conditional',
                    label: takenLabel
                });

                const skipTarget = steps[guardedIndex + 1];
                const skipLabel = prefixLabel ? `${prefixLabel}: else` : 'else';
                if (skipTarget) {
                    edges.push({
                        from: fromStepId,
                        to: skipTarget.id,
                        type: 'sequential',
                        label: skipLabel
                    });
                } else {
                    edges.push({
                        from: fromStepId,
                        to: `END_${guarded.id}`,
                        type: 'sequential',
                        label: skipLabel
                    });
                }
            };

            if (step.type === 'confirmation' && step.options) {
                // Confirmation step: create edges for each option
                for (const option of step.options) {
                    const optionEdges = this.buildConfirmationEdges(steps, i, option, nextStep);
                    edges.push(...optionEdges);
                }
            } else if (nextStep) {
                // Check if next step is conditional (has `when` clause)
                if (nextStep.when) {
                    // Runtime evaluates each step independently.
                    // If the next step is skipped, control proceeds to the immediate following step
                    // (which may also be conditional and will be evaluated normally).
                    addWhenBranchEdges(step.id, i + 1);
                } else {
                    // Regular sequential flow
                    edges.push({
                        from: step.id,
                        to: nextStep.id,
                        type: 'sequential'
                    });
                }
            }
        }

        return edges;
    }

    /**
     * Build edges from a confirmation option.
     *
     * Note: runtime evaluates `when` on the resumed step as usual, even when resuming via
     * a confirmation choice (continue/goto). To model this accurately, we emit a conditional
     * taken/skip branch when the target step is guarded.
     */
    private buildConfirmationEdges(
        steps: SkillStep[],
        stepIndex: number,
        option: { label: string; action: string; gotoStep?: string },
        nextStep?: SkillStep
    ): GraphEdge[] {
        const edges: GraphEdge[] = [];
        const edgeLabel = option.label;

        const pushWhenBranchesFrom = (fromId: string, guardedIndex: number) => {
            const guarded = steps[guardedIndex];
            if (!guarded?.when) return false;

            const conditionLabel = formatCondition(guarded.when);
            edges.push({
                from: fromId,
                to: guarded.id,
                type: 'conditional',
                label: `${edgeLabel}: if ${conditionLabel}`
            });

            const skipTarget = steps[guardedIndex + 1];
            const skipTo = skipTarget ? skipTarget.id : `END_${guarded.id}`;
            edges.push({
                from: fromId,
                to: skipTo,
                type: 'sequential',
                label: `${edgeLabel}: else`
            });

            return true;
        };

        switch (option.action) {
            case 'continue': {
                if (nextStep) {
                    const nextIndex = stepIndex + 1;
                    if (!pushWhenBranchesFrom(steps[stepIndex].id, nextIndex)) {
                        edges.push({
                            from: steps[stepIndex].id,
                            to: nextStep.id,
                            label: edgeLabel,
                            type: 'sequential'
                        });
                    }
                } else {
                    // No next step - continue leads to end (implicit completion)
                    edges.push({
                        from: steps[stepIndex].id,
                        to: `END_${steps[stepIndex].id}`,
                        label: edgeLabel,
                        type: 'sequential'
                    });
                }
                return edges;
            }

            case 'abort': {
                edges.push({
                    from: steps[stepIndex].id,
                    to: `END_${steps[stepIndex].id}`,
                    label: edgeLabel,
                    type: 'abort'
                });
                return edges;
            }

            case 'goto': {
                if (!option.gotoStep) return edges;
                const gotoIndex = steps.findIndex(s => s.id === option.gotoStep);
                if (gotoIndex < 0) return edges;

                // If goto target is guarded, emit taken/skip branches from the confirmation step.
                if (!pushWhenBranchesFrom(steps[stepIndex].id, gotoIndex)) {
                    edges.push({
                        from: steps[stepIndex].id,
                        to: option.gotoStep,
                        label: edgeLabel,
                        type: 'goto'
                    });
                }
                return edges;
            }

            default:
                return edges;
        }
    }

    /**
     * Determine node type from step
     */
    private getNodeType(step: SkillStep): NodeType {
        if (step.type === 'confirmation') {
            return 'confirmation';
        }
        if (step.type === 'tool' || step.tool) {
            return 'tool';
        }
        return 'llm';
    }
}
