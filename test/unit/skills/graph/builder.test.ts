/**
 * Tests for SkillGraphBuilder
 */

import { describe, it, expect } from 'vitest';
import { SkillGraphBuilder } from '../../../../src/skills/graph/builder';
import { createMockSkill, createMockStep } from '../../../helpers/mocks/skill';
import type { SkillStep } from '../../../../src/skills/types';

// ============================================================================
// Tests
// ============================================================================

describe('SkillGraphBuilder', () => {
    const builder = new SkillGraphBuilder();

    describe('build', () => {
        it('returns graph with skill name as title', () => {
            const skill = createMockSkill({ name: 'My Skill' });
            const graph = builder.build(skill);

            expect(graph.title).toBe('My Skill');
        });

        it('creates nodes and edges from steps', () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({ id: 'step1' }),
                    createMockStep({ id: 'step2' })
                ]
            });
            const graph = builder.build(skill);

            expect(graph.nodes).toHaveLength(2);
            expect(graph.edges).toHaveLength(1);
        });
    });

    describe('node building', () => {
        it('creates node with id from step', () => {
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'fetch-data' })]
            });
            const graph = builder.build(skill);

            expect(graph.nodes[0].id).toBe('fetch-data');
        });

        it('creates label from id when no description', () => {
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'step1', description: undefined })]
            });
            const graph = builder.build(skill);

            expect(graph.nodes[0].label).toBe('step1');
        });

        it('creates label from id and description when provided', () => {
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'step1', description: 'Fetch the data' })]
            });
            const graph = builder.build(skill);

            expect(graph.nodes[0].label).toBe('step1: Fetch the data');
        });

        it('preserves tools array on node', () => {
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'step1', tools: ['tool1', 'tool2'] })]
            });
            const graph = builder.build(skill);

            expect(graph.nodes[0].tools).toEqual(['tool1', 'tool2']);
        });

        it('preserves single tool on node', () => {
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'step1', tool: 'specific_tool' })]
            });
            const graph = builder.build(skill);

            expect(graph.nodes[0].tool).toBe('specific_tool');
        });

        it('preserves when condition on node', () => {
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'step1', when: 'inputs.flag === true' })]
            });
            const graph = builder.build(skill);

            expect(graph.nodes[0].condition).toBe('inputs.flag === true');
        });

        it('preserves explicit model on node with source', () => {
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'step1', model: 'fast' } as Partial<SkillStep>)]
            });
            const graph = builder.build(skill);

            expect(graph.nodes[0].model).toBe('fast');
            expect(graph.nodes[0].modelSource).toBe('explicit');
        });

        it('inherits model from skill.models.default for LLM steps', () => {
            const skill = createMockSkill({
                models: { default: 'gpt-4o' },
                steps: [createMockStep({ id: 'step1', type: 'llm' })]
            });
            const graph = builder.build(skill);

            expect(graph.nodes[0].model).toBe('gpt-4o');
            expect(graph.nodes[0].modelSource).toBe('inherited');
        });

        it('explicit step model takes precedence over skill default', () => {
            const skill = createMockSkill({
                models: { default: 'gpt-4o' },
                steps: [createMockStep({ id: 'step1', type: 'llm', model: 'fast' } as Partial<SkillStep>)]
            });
            const graph = builder.build(skill);

            expect(graph.nodes[0].model).toBe('fast');
            expect(graph.nodes[0].modelSource).toBe('explicit');
        });

        it('does not inherit model for non-LLM steps', () => {
            const skill = createMockSkill({
                models: { default: 'gpt-4o' },
                steps: [
                    createMockStep({ id: 'tool-step', type: 'tool', tool: 'some_tool' }),
                    createMockStep({ id: 'confirm-step', type: 'confirmation' })
                ]
            });
            const graph = builder.build(skill);

            // Tool step should not inherit model
            expect(graph.nodes[0].model).toBeUndefined();
            expect(graph.nodes[0].modelSource).toBeUndefined();

            // Confirmation step should not inherit model
            expect(graph.nodes[1].model).toBeUndefined();
            expect(graph.nodes[1].modelSource).toBeUndefined();
        });

        it('no model badge when no skill default and no step model', () => {
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'step1', type: 'llm' })]
            });
            const graph = builder.build(skill);

            expect(graph.nodes[0].model).toBeUndefined();
            expect(graph.nodes[0].modelSource).toBeUndefined();
        });
    });

    describe('node types', () => {
        it('returns llm type for default steps', () => {
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'step1' })]
            });
            const graph = builder.build(skill);

            expect(graph.nodes[0].type).toBe('llm');
        });

        it('returns tool type for tool steps', () => {
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'step1', type: 'tool' })]
            });
            const graph = builder.build(skill);

            expect(graph.nodes[0].type).toBe('tool');
        });

        it('returns tool type for steps with tool property', () => {
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'step1', tool: 'some_tool' })]
            });
            const graph = builder.build(skill);

            expect(graph.nodes[0].type).toBe('tool');
        });

        it('returns confirmation type for confirmation steps', () => {
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'step1', type: 'confirmation' })]
            });
            const graph = builder.build(skill);

            expect(graph.nodes[0].type).toBe('confirmation');
        });
    });

    describe('sequential edges', () => {
        it('creates sequential edge between consecutive steps', () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({ id: 'step1' }),
                    createMockStep({ id: 'step2' })
                ]
            });
            const graph = builder.build(skill);

            expect(graph.edges).toHaveLength(1);
            expect(graph.edges[0]).toEqual({
                from: 'step1',
                to: 'step2',
                type: 'sequential'
            });
        });

        it('creates chain of edges for multiple steps', () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({ id: 'step1' }),
                    createMockStep({ id: 'step2' }),
                    createMockStep({ id: 'step3' })
                ]
            });
            const graph = builder.build(skill);

            expect(graph.edges).toHaveLength(2);
            expect(graph.edges[0].from).toBe('step1');
            expect(graph.edges[0].to).toBe('step2');
            expect(graph.edges[1].from).toBe('step2');
            expect(graph.edges[1].to).toBe('step3');
        });

        it('creates no edges for single step', () => {
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'step1' })]
            });
            const graph = builder.build(skill);

            expect(graph.edges).toHaveLength(0);
        });
    });

    describe('conditional edges (when clauses)', () => {
        it('creates conditional edge to guarded step', () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({ id: 'step1' }),
                    createMockStep({ id: 'step2', when: 'inputs.enabled' })
                ]
            });
            const graph = builder.build(skill);

            expect(graph.edges).toContainEqual({
                from: 'step1',
                to: 'step2',
                type: 'conditional',
                label: 'if inputs.enabled'
            });
        });

        it('creates skip edge to the immediate next step when guarded step is skipped', () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({ id: 'step1' }),
                    createMockStep({ id: 'step2', when: 'inputs.enabled' }),
                    createMockStep({ id: 'step3' })
                ]
            });
            const graph = builder.build(skill);

            // Should have: step1 -> step2 (conditional), step1 -> step3 (skip), step2 -> step3
            expect(graph.edges).toContainEqual({
                from: 'step1',
                to: 'step3',
                type: 'sequential',
                label: 'else'
            });
        });

        it('does not jump over multiple consecutive guarded steps', () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({ id: 'step1' }),
                    createMockStep({ id: 'step2', when: 'condition1' }),
                    createMockStep({ id: 'step3', when: 'condition2' }),
                    createMockStep({ id: 'step4' }) // First non-guarded step
                ]
            });
            const graph = builder.build(skill);

            // If step2 is skipped, control proceeds to step3 (which is evaluated independently)
            expect(graph.edges).toContainEqual({
                from: 'step1',
                to: 'step3',
                type: 'sequential',
                label: 'else'
            });

            // If step3 is skipped (after step2 runs), control proceeds to step4
            expect(graph.edges).toContainEqual({
                from: 'step2',
                to: 'step4',
                type: 'sequential',
                label: 'else'
            });
        });

        it('truncates long condition labels', () => {
            const longCondition = 'inputs.' + 'someVeryLongConditionThatExceedsTheMaxLength_'.repeat(3) + '=== true';
            const skill = createMockSkill({
                steps: [
                    createMockStep({ id: 'step1' }),
                    createMockStep({ id: 'step2', when: longCondition })
                ]
            });
            const graph = builder.build(skill);

            const conditionalEdge = graph.edges.find(e => e.type === 'conditional');
            expect(conditionalEdge?.label?.length).toBeLessThanOrEqual(80 + 3); // includes "if " prefix
            expect(conditionalEdge?.label).toContain('...');
        });
    });

    describe('confirmation edges', () => {
        it('creates edge for continue action to next step', () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({
                        id: 'confirm',
                        type: 'confirmation',
                        options: [{ label: 'Yes', action: 'continue' }]
                    }),
                    createMockStep({ id: 'next' })
                ]
            });
            const graph = builder.build(skill);

            expect(graph.edges).toContainEqual({
                from: 'confirm',
                to: 'next',
                label: 'Yes',
                type: 'sequential'
            });
        });

        it('creates edge for continue action to END when no next step', () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({
                        id: 'confirm',
                        type: 'confirmation',
                        options: [{ label: 'Done', action: 'continue' }]
                    })
                ]
            });
            const graph = builder.build(skill);

            expect(graph.edges).toContainEqual({
                from: 'confirm',
                to: 'END_confirm',
                label: 'Done',
                type: 'sequential'
            });
        });

        it('creates abort edge to END', () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({
                        id: 'confirm',
                        type: 'confirmation',
                        options: [{ label: 'Cancel', action: 'abort' }]
                    })
                ]
            });
            const graph = builder.build(skill);

            expect(graph.edges).toContainEqual({
                from: 'confirm',
                to: 'END_confirm',
                label: 'Cancel',
                type: 'abort'
            });
        });

        it('creates goto edge to target step', () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({ id: 'step1' }),
                    createMockStep({
                        id: 'confirm',
                        type: 'confirmation',
                        options: [{ label: 'Retry', action: 'goto', gotoStep: 'step1' }]
                    })
                ]
            });
            const graph = builder.build(skill);

            expect(graph.edges).toContainEqual({
                from: 'confirm',
                to: 'step1',
                label: 'Retry',
                type: 'goto'
            });
        });

        it('ignores goto without gotoStep', () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({
                        id: 'confirm',
                        type: 'confirmation',
                        options: [{ label: 'Retry', action: 'goto' }] // Missing gotoStep
                    })
                ]
            });
            const graph = builder.build(skill);

            // Should not create any edge for invalid goto
            expect(graph.edges).toHaveLength(0);
        });

        it('creates multiple edges for multiple options', () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({
                        id: 'confirm',
                        type: 'confirmation',
                        options: [
                            { label: 'Yes', action: 'continue' },
                            { label: 'No', action: 'abort' }
                        ]
                    }),
                    createMockStep({ id: 'next' })
                ]
            });
            const graph = builder.build(skill);

            expect(graph.edges).toHaveLength(2);
            expect(graph.edges).toContainEqual({
                from: 'confirm',
                to: 'next',
                label: 'Yes',
                type: 'sequential'
            });
            expect(graph.edges).toContainEqual({
                from: 'confirm',
                to: 'END_confirm',
                label: 'No',
                type: 'abort'
            });
        });
    });

    describe('edge cases', () => {
        it('handles empty steps array', () => {
            const skill = createMockSkill({ steps: [] });
            const graph = builder.build(skill);

            expect(graph.nodes).toHaveLength(0);
            expect(graph.edges).toHaveLength(0);
        });

        it('handles confirmation step without options', () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({
                        id: 'confirm',
                        type: 'confirmation'
                        // No options
                    }),
                    createMockStep({ id: 'next' })
                ]
            });
            const graph = builder.build(skill);

            // Should create normal sequential edge since no options
            expect(graph.edges).toContainEqual({
                from: 'confirm',
                to: 'next',
                type: 'sequential'
            });
        });

        it('handles all guarded steps (no bypass target)', () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({ id: 'step1' }),
                    createMockStep({ id: 'step2', when: 'condition1' }),
                    createMockStep({ id: 'step3', when: 'condition2' })
                    // All remaining steps are guarded
                ]
            });
            const graph = builder.build(skill);

            // If step2 is skipped, control proceeds to step3 (even though it's also guarded)
            expect(graph.edges).toContainEqual({
                from: 'step1',
                to: 'step3',
                type: 'sequential',
                label: 'else'
            });
        });
    });
});
