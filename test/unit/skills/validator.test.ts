/**
 * Tests for skills/validators - validation engine
 *
 * Tests semantic validation logic that runs AFTER Zod validation in parser.
 * Zod structural validation (unknown keys, types, required fields) is tested in parser.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspace, FileType, FileSystemError } from 'vscode';
import { validateSkill, formatValidationResult } from '../../../src/skills/validators';
import {
    createMockSkill,
    createMockStep,
    createMockInput,
    createMockValidationResult,
    createMockValidationIssue,
    createMockConfirmationOption,
} from '../../helpers/mocks/skill';

describe('validator', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        // Default: all files exist (stat succeeds)
        vi.mocked(workspace.fs.stat).mockResolvedValue({
            type: FileType.File,
            ctime: Date.now(),
            mtime: Date.now(),
            size: 100,
        });
    });

    describe('validateSkill', () => {
        describe('basic validation', () => {
            it('returns valid for well-formed skill', async () => {
                const skill = createMockSkill({
                    name: 'Valid Skill',
                    description: 'A valid skill',
                    steps: [createMockStep({ id: 'step-1', file: 'steps/01.md' })],
                });

                const result = await validateSkill(skill);
                expect(result.valid).toBe(true);
                expect(result.errors).toHaveLength(0);
            });

        });

        describe('step ID validation', () => {
            it('reports error for invalid requires reference', async () => {
                const skill = createMockSkill({
                    steps: [createMockStep({ id: 'step-1', requires: ['nonexistent'] })],
                });

                const result = await validateSkill(skill);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.message.includes("requires") && e.message.includes("unknown"))).toBe(
                    true
                );
            });

            it('allows valid requires reference', async () => {
                const skill = createMockSkill({
                    steps: [
                        createMockStep({ id: 'step-1', file: 'steps/01.md' }),
                        createMockStep({ id: 'step-2', file: 'steps/02.md', requires: ['step-1'] }),
                    ],
                });

                const result = await validateSkill(skill);
                expect(result.valid).toBe(true);
            });
        });

        describe('step file validation', () => {
            it('reports error for missing step file', async () => {
                // File doesn't exist - stat throws
                vi.mocked(workspace.fs.stat).mockRejectedValue(
                    FileSystemError.FileNotFound('File not found')
                );

                const skill = createMockSkill({
                    steps: [createMockStep({ id: 'step-1', file: 'steps/missing.md' })],
                });

                const result = await validateSkill(skill);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.ruleId === 'schema/step-files')).toBe(true);
            });

            it('allows confirmation steps without file if message is provided', async () => {
                const skill = createMockSkill({
                    steps: [
                        createMockStep({
                            id: 'confirm',
                            type: 'confirmation',
                            file: undefined,
                            message: 'Continue?',
                        }),
                    ],
                });

                const result = await validateSkill(skill);
                expect(result.valid).toBe(true);
            });

            it('allows LLM step with inline message instead of file', async () => {
                const skill = createMockSkill({
                    inputs: [createMockInput({ name: 'data', type: 'string' })],
                    steps: [
                        createMockStep({
                            id: 'step-1',
                            type: 'llm',
                            file: undefined,
                            message: 'Analyze this: {{ inputs.data }}',
                        }),
                    ],
                });

                const result = await validateSkill(skill);
                expect(result.valid).toBe(true);
            });
        });

        describe('input validation', () => {
            it('warns about enum with non-string type', async () => {
                const skill = createMockSkill({
                    inputs: [
                        createMockInput({ name: 'count', type: 'number', enum: ['1', '2', '3'] }),
                    ],
                });

                const result = await validateSkill(skill);
                expect(result.warnings.some((w) => w.message.includes('enum'))).toBe(true);
            });

            it('warns about pattern with non-string type', async () => {
                const skill = createMockSkill({
                    inputs: [
                        createMockInput({ name: 'count', type: 'number', pattern: '^\\d+$' }),
                    ],
                });

                const result = await validateSkill(skill);
                expect(result.warnings.some((w) => w.message.includes('pattern'))).toBe(true);
            });
        });

        describe('confirmation step validation', () => {
            it('allows confirmation with file', async () => {
                const skill = createMockSkill({
                    steps: [
                        createMockStep({
                            id: 'confirm',
                            type: 'confirmation',
                            file: 'steps/confirm.md',
                        }),
                    ],
                });

                const result = await validateSkill(skill);
                expect(result.valid).toBe(true);
            });
        });

        describe('goto reference validation', () => {
            it('reports error for goto referencing unknown step', async () => {
                const skill = createMockSkill({
                    steps: [
                        createMockStep({
                            id: 'confirm',
                            type: 'confirmation',
                            message: 'Choose',
                            options: [
                                createMockConfirmationOption({
                                    action: 'goto',
                                    gotoStep: 'nonexistent',
                                }),
                            ],
                        }),
                    ],
                });

                const result = await validateSkill(skill);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.message.includes('unknown step'))).toBe(true);
            });

            it('allows valid goto reference', async () => {
                const skill = createMockSkill({
                    steps: [
                        createMockStep({ id: 'step-1', file: 'steps/01.md' }),
                        createMockStep({
                            id: 'confirm',
                            type: 'confirmation',
                            file: undefined,
                            message: 'Retry?',
                            options: [
                                createMockConfirmationOption({ action: 'goto', gotoStep: 'step-1' }),
                                createMockConfirmationOption({ action: 'continue' }),
                            ],
                        }),
                    ],
                });

                const result = await validateSkill(skill);
                expect(result.valid).toBe(true);
            });
        });

        describe('guard pattern validation', () => {
            it('reports error for confirmation with only abort options and no when condition', async () => {
                const skill = createMockSkill({
                    steps: [
                        createMockStep({
                            id: 'dead-end',
                            type: 'confirmation',
                            file: undefined,
                            message: 'This is a dead end',
                            options: [
                                createMockConfirmationOption({ label: 'Cancel', action: 'abort' }),
                            ],
                        }),
                    ],
                });

                const result = await validateSkill(skill);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.message.includes('no way to continue'))).toBe(true);
            });

            it('allows confirmation with only abort options when has when condition (guard pattern)', async () => {
                const skill = createMockSkill({
                    steps: [
                        createMockStep({ id: 'step-1', file: 'steps/01.md', output: 'data' }),
                        createMockStep({
                            id: 'guard-check',
                            type: 'confirmation',
                            file: undefined,
                            when: 'outputs.data.count == 0',
                            message: 'No data found. Cannot proceed.',
                            options: [
                                createMockConfirmationOption({ label: 'Cancel', action: 'abort' }),
                            ],
                        }),
                        createMockStep({ id: 'step-2', file: 'steps/02.md' }),
                    ],
                });

                const result = await validateSkill(skill);
                expect(result.valid).toBe(true);
                expect(result.errors.filter((e) => e.message.includes('no way to continue'))).toHaveLength(0);
            });

            it('allows guard pattern with multiple abort options', async () => {
                const skill = createMockSkill({
                    steps: [
                        createMockStep({
                            id: 'guard-check',
                            type: 'confirmation',
                            file: undefined,
                            when: 'inputs.required_field == ""',
                            message: 'Missing required field',
                            options: [
                                createMockConfirmationOption({ label: 'Cancel', action: 'abort' }),
                                createMockConfirmationOption({ label: 'Abort and retry later', action: 'abort' }),
                            ],
                        }),
                    ],
                });

                const result = await validateSkill(skill);
                expect(result.valid).toBe(true);
            });

            it('error message suggests adding when condition for dead-end confirmation', async () => {
                const skill = createMockSkill({
                    steps: [
                        createMockStep({
                            id: 'dead-end',
                            type: 'confirmation',
                            file: undefined,
                            message: 'Dead end',
                            options: [
                                createMockConfirmationOption({ label: 'Abort', action: 'abort' }),
                            ],
                        }),
                    ],
                });

                const result = await validateSkill(skill);
                expect(result.valid).toBe(false);
                const error = result.errors.find((e) => e.message.includes('no way to continue'));
                expect(error?.suggestion).toContain('when');
            });
        });

        describe('output variable validation', () => {
            it('allows unique output variables', async () => {
                const skill = createMockSkill({
                    steps: [
                        createMockStep({ id: 'step-1', file: 'steps/01.md', output: 'result1' }),
                        createMockStep({ id: 'step-2', file: 'steps/02.md', output: 'result2' }),
                    ],
                });

                const result = await validateSkill(skill);
                expect(result.valid).toBe(true);
            });
        });

        describe('output summary loop variable handling', () => {
            it('allows loop variables in output summary for loops', async () => {
                const skill = createMockSkill({
                    steps: [
                        createMockStep({ id: 'step-1', file: 'steps/01.md', output: 'created_tests' }),
                    ],
                    output: {
                        summary: `
                            ### Created Tests
                            {% for test in outputs.created_tests.items %}
                            - {{ test.key }} - {{ test.summary }}
                            {% endfor %}
                        `,
                    },
                });

                const result = await validateSkill(skill);
                // Should NOT report errors for test.key or test.summary
                // because 'test' is a loop variable
                const loopVarErrors = result.errors.filter(
                    (e) => e.message.includes('test.key') || e.message.includes('test.summary')
                );
                expect(loopVarErrors).toHaveLength(0);
            });

            it('still reports errors for undefined non-loop variables', async () => {
                const skill = createMockSkill({
                    steps: [
                        createMockStep({ id: 'step-1', file: 'steps/01.md', output: 'data' }),
                    ],
                    output: {
                        summary: `
                            {{ outputs.undefined_output.value }}
                            {% for item in outputs.data.items %}
                            - {{ item.name }}
                            {% endfor %}
                        `,
                    },
                });

                const result = await validateSkill(skill);
                // Should report error for undefined_output but not for item.name
                expect(result.errors.some((e) => e.message.includes('undefined_output'))).toBe(true);
                expect(result.errors.some((e) => e.message.includes('item.name'))).toBe(false);
            });

            it('handles multiple nested loops in output summary', async () => {
                const skill = createMockSkill({
                    steps: [
                        createMockStep({ id: 'step-1', file: 'steps/01.md', output: 'groups' }),
                    ],
                    output: {
                        summary: `
                            {% for group in outputs.groups %}
                            ## {{ group.name }}
                            {% for item in group.items %}
                            - {{ item.title }}
                            {% endfor %}
                            {% endfor %}
                        `,
                    },
                });

                const result = await validateSkill(skill);
                // Should not report errors for group.name, group.items, or item.title
                const loopVarErrors = result.errors.filter(
                    (e) => e.message.includes('group.') || e.message.includes('item.')
                );
                expect(loopVarErrors).toHaveLength(0);
            });
        });

        describe('circular reference detection', () => {
            describe('requires cycles', () => {
                it('reports error for direct self-reference in requires', async () => {
                    const skill = createMockSkill({
                        steps: [
                            createMockStep({ id: 'step-1', file: 'steps/01.md', requires: ['step-1'] }),
                        ],
                    });

                    const result = await validateSkill(skill);
                    expect(result.valid).toBe(false);
                    // Self-reference in requires is caught by requires-ordering (future step) or circular refs
                    expect(result.errors.some((e) => e.category === 'flow')).toBe(true);
                });

                it('reports error for two-step cycle in requires', async () => {
                    const skill = createMockSkill({
                        steps: [
                            createMockStep({ id: 'step-a', file: 'steps/01.md', requires: ['step-b'] }),
                            createMockStep({ id: 'step-b', file: 'steps/02.md', requires: ['step-a'] }),
                        ],
                    });

                    const result = await validateSkill(skill);
                    expect(result.valid).toBe(false);
                    expect(result.errors.some((e) => e.category === 'flow')).toBe(true);
                });

                it('reports error for three-step cycle in requires', async () => {
                    const skill = createMockSkill({
                        steps: [
                            createMockStep({ id: 'step-a', file: 'steps/01.md', requires: ['step-c'] }),
                            createMockStep({ id: 'step-b', file: 'steps/02.md', requires: ['step-a'] }),
                            createMockStep({ id: 'step-c', file: 'steps/03.md', requires: ['step-b'] }),
                        ],
                    });

                    const result = await validateSkill(skill);
                    expect(result.valid).toBe(false);
                    expect(result.errors.some((e) => e.category === 'flow')).toBe(true);
                });

                it('allows valid DAG in requires', async () => {
                    const skill = createMockSkill({
                        steps: [
                            createMockStep({ id: 'step-1', file: 'steps/01.md' }),
                            createMockStep({ id: 'step-2', file: 'steps/02.md', requires: ['step-1'] }),
                            createMockStep({ id: 'step-3', file: 'steps/03.md', requires: ['step-1', 'step-2'] }),
                        ],
                    });

                    const result = await validateSkill(skill);
                    expect(result.valid).toBe(true);
                    expect(result.errors.filter((e) => e.category === 'flow')).toHaveLength(0);
                });
            });

            describe('goto cycles', () => {
                it('warns about direct self-reference in goto', async () => {
                    const skill = createMockSkill({
                        steps: [
                            createMockStep({
                                id: 'confirm',
                                type: 'confirmation',
                                file: undefined,
                                message: 'Retry?',
                                options: [
                                    createMockConfirmationOption({ action: 'goto', gotoStep: 'confirm' }),
                                    createMockConfirmationOption({ action: 'continue' }),
                                ],
                            }),
                        ],
                    });

                    const result = await validateSkill(skill);
                    // Goto cycles are warnings, not errors (may be intentional retry loops)
                    expect(result.valid).toBe(true);
                    // Self-loops are detected by ConfirmationPathsValidator (provides option label context)
                    // CircularReferencesValidator skips single-node cycles to avoid duplicate warnings
                    expect(result.warnings.some((w) => w.ruleId === 'semantic/circular-references')).toBe(false);
                    expect(result.warnings.some((w) => w.ruleId === 'semantic/confirmation-paths' && w.message.includes('self-loop'))).toBe(true);
                });

                it('warns about two-step cycle in goto', async () => {
                    const skill = createMockSkill({
                        steps: [
                            createMockStep({
                                id: 'confirm-a',
                                type: 'confirmation',
                                file: undefined,
                                message: 'Step A',
                                options: [
                                    createMockConfirmationOption({ action: 'goto', gotoStep: 'confirm-b' }),
                                ],
                            }),
                            createMockStep({
                                id: 'confirm-b',
                                type: 'confirmation',
                                file: undefined,
                                message: 'Step B',
                                options: [
                                    createMockConfirmationOption({ action: 'goto', gotoStep: 'confirm-a' }),
                                ],
                            }),
                        ],
                    });

                    const result = await validateSkill(skill);
                    expect(result.valid).toBe(true);
                    expect(result.warnings.some((w) => w.ruleId === 'semantic/circular-references')).toBe(true);
                });

                it('allows valid goto references without cycles', async () => {
                    const skill = createMockSkill({
                        steps: [
                            createMockStep({ id: 'step-1', file: 'steps/01.md' }),
                            createMockStep({
                                id: 'confirm',
                                type: 'confirmation',
                                file: undefined,
                                message: 'Retry step 1?',
                                options: [
                                    createMockConfirmationOption({ action: 'goto', gotoStep: 'step-1' }),
                                    createMockConfirmationOption({ action: 'continue' }),
                                ],
                            }),
                            createMockStep({ id: 'step-2', file: 'steps/02.md' }),
                        ],
                    });

                    const result = await validateSkill(skill);
                    expect(result.valid).toBe(true);
                    // No goto cycles - going back to step-1 isn't a cycle in the goto graph
                    expect(result.warnings.filter((w) => w.ruleId === 'semantic/circular-references')).toHaveLength(0);
                });
            });

            describe('mixed scenarios', () => {
                it('detects both requires and goto cycles independently', async () => {
                    const skill = createMockSkill({
                        steps: [
                            createMockStep({ id: 'step-a', file: 'steps/01.md', requires: ['step-b'] }),
                            createMockStep({ id: 'step-b', file: 'steps/02.md', requires: ['step-a'] }),
                            createMockStep({
                                id: 'confirm',
                                type: 'confirmation',
                                file: undefined,
                                message: 'Retry?',
                                options: [
                                    createMockConfirmationOption({ action: 'goto', gotoStep: 'confirm' }),
                                ],
                            }),
                        ],
                    });

                    const result = await validateSkill(skill);
                    expect(result.valid).toBe(false); // requires cycle is an error
                    expect(result.errors.some((e) => e.category === 'flow')).toBe(true);
                    // Self-loop detected by ConfirmationPathsValidator (more context)
                    // CircularReferencesValidator skips single-node cycles
                    expect(result.warnings.some((w) => w.ruleId === 'semantic/confirmation-paths' && w.message.includes('self-loop'))).toBe(true);
                });

                it('handles complex skill with no cycles', async () => {
                    const skill = createMockSkill({
                        steps: [
                            createMockStep({ id: 'init', file: 'steps/01.md' }),
                            createMockStep({ id: 'fetch', file: 'steps/02.md', requires: ['init'] }),
                            createMockStep({
                                id: 'confirm-fetch',
                                type: 'confirmation',
                                file: undefined,
                                message: 'Fetch succeeded?',
                                options: [
                                    createMockConfirmationOption({ action: 'goto', gotoStep: 'fetch' }),
                                    createMockConfirmationOption({ action: 'continue' }),
                                ],
                            }),
                            createMockStep({ id: 'process', file: 'steps/03.md', requires: ['fetch'] }),
                            createMockStep({ id: 'output', file: 'steps/04.md', requires: ['process'] }),
                        ],
                    });

                    const result = await validateSkill(skill);
                    expect(result.valid).toBe(true);
                    expect(result.errors.filter((e) => e.category === 'flow')).toHaveLength(0);
                    // Note: goto to 'fetch' is not a cycle because 'confirm-fetch' doesn't point to itself
                    expect(result.warnings.filter((w) => w.ruleId === 'semantic/circular-references')).toHaveLength(0);
                });
            });
        });
    });

    describe('formatValidationResult', () => {
        it('formats valid result with no warnings', () => {
            const result = createMockValidationResult({ valid: true, errors: [], warnings: [] });
            const formatted = formatValidationResult('my-skill', result);

            expect(formatted).toContain('my-skill');
            expect(formatted).toContain('valid');
            expect(formatted).toContain('✅');
        });

        it('formats errors list', () => {
            const result = createMockValidationResult({
                valid: false,
                errors: [createMockValidationIssue({ message: 'Name is required' })],
                warnings: [],
            });
            const formatted = formatValidationResult('my-skill', result);

            expect(formatted).toContain('❌');
            expect(formatted).toContain('error');
            expect(formatted).toContain('Name is required');
        });

        it('formats warnings list for valid skill', () => {
            const result = createMockValidationResult({
                valid: true,
                errors: [],
                warnings: [createMockValidationIssue({ message: 'Description recommended', severity: 'warning' })],
            });
            const formatted = formatValidationResult('my-skill', result);

            expect(formatted).toContain('⚠️');
            expect(formatted).toContain('warning');
            expect(formatted).toContain('Description recommended');
        });

        it('formats both errors and warnings', () => {
            const result = createMockValidationResult({
                valid: false,
                errors: [createMockValidationIssue({ message: 'Error message' })],
                warnings: [createMockValidationIssue({ message: 'Warning message', severity: 'warning' })],
            });
            const formatted = formatValidationResult('my-skill', result);

            expect(formatted).toContain('Error message');
            expect(formatted).toContain('Warning message');
        });

        it('includes skill ID in output', () => {
            const result = createMockValidationResult();
            const formatted = formatValidationResult('unique-skill-id', result);

            expect(formatted).toContain('unique-skill-id');
        });
    });

    describe('confirmation options (S-10)', () => {
        it('errors when a confirmation step has an explicitly empty options list', async () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({
                        id: 'review',
                        type: 'confirmation',
                        message: 'Proceed?',
                        options: [],
                    }),
                ],
            });

            const result = await validateSkill(skill);
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) => e.ruleId === 'schema/confirmation-options' && e.message.includes('empty options list')
                )
            ).toBe(true);
        });

        it('allows a confirmation step that omits options (defaults apply)', async () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({ id: 'review', type: 'confirmation', message: 'Proceed?' }),
                ],
            });

            const result = await validateSkill(skill);
            expect(
                result.errors.some((e) => e.message.includes('empty options list'))
            ).toBe(false);
        });
    });

    describe('tool step reference (S-04)', () => {
        it('warns when a tool step references a near-miss of a declared alias', async () => {
            const skill = createMockSkill({
                tools: { aliases: { fetch_article: 'mcp_mcp-acme_item_get' } },
                steps: [
                    createMockStep({ id: 'save', type: 'tool', tool: 'fetch_articl' }), // typo of fetch_article
                ],
            });

            const result = await validateSkill(skill);
            expect(
                result.warnings.some(
                    (w) => w.ruleId === 'schema/tool-configuration' && w.message.includes('not a declared alias')
                )
            ).toBe(true);
        });

        it('does not warn when a tool step uses a declared alias', async () => {
            const skill = createMockSkill({
                tools: { aliases: { fetch_article: 'mcp_mcp-acme_item_get' } },
                steps: [
                    createMockStep({ id: 'save', type: 'tool', tool: 'fetch_article' }),
                ],
            });

            const result = await validateSkill(skill);
            expect(
                result.warnings.some((w) => w.message.includes('not a declared alias'))
            ).toBe(false);
        });
    });

    describe('when condition syntax (S-14)', () => {
        it('errors on a condition that fails to parse (would silently be false)', async () => {
            // Nested {{ }} inside the implicit {% if %} is invalid Liquid and would
            // throw → be swallowed → evaluate false at runtime.
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'a', when: '{{ outputs.x }} == 5' })],
            });

            const result = await validateSkill(skill);
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) => e.ruleId === 'template/condition-syntax' && e.message.includes('always evaluate to false')
                )
            ).toBe(true);
        });

        it('does not error on a valid condition', async () => {
            const skill = createMockSkill({
                steps: [createMockStep({ id: 'a', when: 'inputs.id == "x"' })],
            });

            const result = await validateSkill(skill);
            expect(
                result.errors.some((e) => e.ruleId === 'template/condition-syntax')
            ).toBe(false);
        });
    });

    describe('loop-carried variable scope', () => {
        it('allows a step to reference outputs produced later in a goto loop body', async () => {
            // `ask` references `outputs.reply`, defined by the later `answer` step,
            // which loops back to `ask` — legitimate loop-carried state.
            const skill = createMockSkill({
                steps: [
                    createMockStep({
                        id: 'ask',
                        type: 'confirmation',
                        file: undefined,
                        message: 'You last said: {{ outputs.reply }}',
                        output: 'question',
                    }),
                    createMockStep({
                        id: 'answer',
                        type: 'confirmation',
                        file: undefined,
                        message: 'Pick one',
                        output: 'reply',
                        options: [
                            createMockConfirmationOption({ label: 'Again', action: 'goto', gotoStep: 'ask' }),
                            createMockConfirmationOption({ label: 'Done', action: 'continue' }),
                        ],
                    }),
                ],
            });

            const result = await validateSkill(skill);
            expect(
                result.errors.filter((e) => e.ruleId === 'template/variable-existence')
            ).toHaveLength(0);
        });

        it('still flags a forward output reference when there is no loop', async () => {
            const skill = createMockSkill({
                steps: [
                    createMockStep({
                        id: 'first',
                        type: 'confirmation',
                        file: undefined,
                        message: 'Later value: {{ outputs.late }}',
                    }),
                    createMockStep({
                        id: 'second',
                        type: 'confirmation',
                        file: undefined,
                        message: 'x',
                        output: 'late',
                    }),
                ],
            });

            const result = await validateSkill(skill);
            expect(
                result.errors.some((e) => e.ruleId === 'template/variable-existence')
            ).toBe(true);
        });
    });
});
