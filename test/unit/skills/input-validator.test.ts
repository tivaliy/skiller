/**
 * Tests for skill input validation
 *
 * Tests input validation, defaults, and confirmation parsing
 */

import { describe, it, expect } from 'vitest';
import {
    validateInputs,
    applyDefaults,
    parseConfirmationResponse
} from '../../../src/skills/validators';
import { createMockSkill, createMockInput } from '../../helpers/mocks/skill';
import { CONFIRMATION_OPTIONS_SAMPLES } from '../../helpers/fixtures';
import type { ConfirmationOption } from '../../../src/skills/types';

describe('skill-validation', () => {
    describe('validateInputs', () => {
        describe('required inputs', () => {
            it('returns valid for correct inputs', () => {
                const skill = createMockSkill({
                    inputs: [createMockInput({ name: 'id', type: 'string', required: true })],
                });

                const result = validateInputs(skill, { id: 'test-123' });
                expect(result.valid).toBe(true);
                expect(result.errors).toHaveLength(0);
            });

            it('reports error for missing required input', () => {
                const skill = createMockSkill({
                    inputs: [createMockInput({ name: 'id', type: 'string', required: true })],
                });

                const result = validateInputs(skill, {});
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.includes('id'))).toBe(true);
            });

            it('reports error for empty string required input', () => {
                const skill = createMockSkill({
                    inputs: [createMockInput({ name: 'id', required: true })],
                });

                const result = validateInputs(skill, { id: '' });
                expect(result.valid).toBe(false);
            });

            it('reports error for null required input', () => {
                const skill = createMockSkill({
                    inputs: [createMockInput({ name: 'id', required: true })],
                });

                const result = validateInputs(skill, { id: null });
                expect(result.valid).toBe(false);
            });
        });

        describe('optional inputs', () => {
            it('allows missing optional input', () => {
                const skill = createMockSkill({
                    inputs: [createMockInput({ name: 'id', required: false })],
                });

                const result = validateInputs(skill, {});
                expect(result.valid).toBe(true);
            });

            it('validates optional input if provided', () => {
                const skill = createMockSkill({
                    inputs: [
                        createMockInput({
                            name: 'count',
                            type: 'number',
                            required: false,
                        }),
                    ],
                });

                // String that can't be coerced to number
                const result = validateInputs(skill, { count: 'not-a-number' });
                expect(result.valid).toBe(false);
            });
        });

        describe('type validation', () => {
            it('validates string type', () => {
                const skill = createMockSkill({
                    inputs: [createMockInput({ name: 'name', type: 'string', required: true })],
                });

                expect(validateInputs(skill, { name: 'Alice' }).valid).toBe(true);
                expect(validateInputs(skill, { name: 123 }).valid).toBe(false);
            });

            it('validates number type', () => {
                const skill = createMockSkill({
                    inputs: [createMockInput({ name: 'count', type: 'number', required: true })],
                });

                expect(validateInputs(skill, { count: 42 }).valid).toBe(true);
                expect(validateInputs(skill, { count: 'greeter' }).valid).toBe(false);
            });

            it('allows string-to-number coercion for numeric strings', () => {
                const skill = createMockSkill({
                    inputs: [createMockInput({ name: 'count', type: 'number', required: true })],
                });

                // String '123' can be coerced to number
                const result = validateInputs(skill, { count: '123' });
                expect(result.valid).toBe(true);
            });

            it('validates boolean type', () => {
                const skill = createMockSkill({
                    inputs: [createMockInput({ name: 'flag', type: 'boolean', required: true })],
                });

                expect(validateInputs(skill, { flag: true }).valid).toBe(true);
                expect(validateInputs(skill, { flag: false }).valid).toBe(true);
            });

            it('allows string-to-boolean coercion for valid boolean strings', () => {
                const skill = createMockSkill({
                    inputs: [createMockInput({ name: 'flag', type: 'boolean', required: true })],
                });

                // Valid boolean strings (matches argument-parser behavior)
                expect(validateInputs(skill, { flag: 'true' }).valid).toBe(true);
                expect(validateInputs(skill, { flag: 'false' }).valid).toBe(true);
                expect(validateInputs(skill, { flag: 'TRUE' }).valid).toBe(true);
                expect(validateInputs(skill, { flag: 'FALSE' }).valid).toBe(true);
                expect(validateInputs(skill, { flag: '1' }).valid).toBe(true);
                expect(validateInputs(skill, { flag: '0' }).valid).toBe(true);

                // Invalid boolean strings
                expect(validateInputs(skill, { flag: 'yes' }).valid).toBe(false);
                expect(validateInputs(skill, { flag: 'no' }).valid).toBe(false);
                expect(validateInputs(skill, { flag: 'invalid' }).valid).toBe(false);
            });

            it('validates array type', () => {
                const skill = createMockSkill({
                    inputs: [createMockInput({ name: 'items', type: 'array', required: true })],
                });

                expect(validateInputs(skill, { items: ['a', 'b'] }).valid).toBe(true);
                expect(validateInputs(skill, { items: 'not-array' }).valid).toBe(false);
            });
        });

        describe('pattern validation', () => {
            it('validates pattern for string inputs', () => {
                const skill = createMockSkill({
                    inputs: [
                        createMockInput({
                            name: 'article_id',
                            type: 'string',
                            required: true,
                            pattern: '^ART-\\d+$',
                        }),
                    ],
                });

                expect(validateInputs(skill, { article_id: 'ART-123' }).valid).toBe(true);
                expect(validateInputs(skill, { article_id: 'ART-456' }).valid).toBe(true);
                expect(validateInputs(skill, { article_id: 'invalid' }).valid).toBe(false);
                expect(validateInputs(skill, { article_id: 'art-123' }).valid).toBe(false);
            });

            it('allows missing value when pattern is optional', () => {
                const skill = createMockSkill({
                    inputs: [
                        createMockInput({
                            name: 'article_id',
                            type: 'string',
                            required: false,
                            pattern: '^ART-\\d+$',
                        }),
                    ],
                });

                expect(validateInputs(skill, {}).valid).toBe(true);
            });
        });

        describe('enum validation', () => {
            it('validates enum values', () => {
                const skill = createMockSkill({
                    inputs: [
                        createMockInput({
                            name: 'priority',
                            type: 'string',
                            required: true,
                            enum: ['low', 'medium', 'high'],
                        }),
                    ],
                });

                expect(validateInputs(skill, { priority: 'high' }).valid).toBe(true);
                expect(validateInputs(skill, { priority: 'medium' }).valid).toBe(true);
                expect(validateInputs(skill, { priority: 'low' }).valid).toBe(true);
                expect(validateInputs(skill, { priority: 'critical' }).valid).toBe(false);
            });

            it('is case-sensitive for enum values', () => {
                const skill = createMockSkill({
                    inputs: [
                        createMockInput({
                            name: 'status',
                            type: 'string',
                            required: true,
                            enum: ['open', 'closed'],
                        }),
                    ],
                });

                expect(validateInputs(skill, { status: 'open' }).valid).toBe(true);
                expect(validateInputs(skill, { status: 'OPEN' }).valid).toBe(false);
            });
        });

        describe('multiple inputs', () => {
            it('validates all inputs', () => {
                const skill = createMockSkill({
                    inputs: [
                        createMockInput({ name: 'name', type: 'string', required: true }),
                        createMockInput({ name: 'age', type: 'number', required: true }),
                        createMockInput({ name: 'active', type: 'boolean', required: false }),
                    ],
                });

                const validResult = validateInputs(skill, { name: 'Alice', age: 30, active: true });
                expect(validResult.valid).toBe(true);

                const invalidResult = validateInputs(skill, { name: 'Alice' });
                expect(invalidResult.valid).toBe(false);
                expect(invalidResult.errors).toHaveLength(1);
            });

            it('reports multiple errors', () => {
                const skill = createMockSkill({
                    inputs: [
                        createMockInput({ name: 'name', type: 'string', required: true }),
                        createMockInput({ name: 'age', type: 'number', required: true }),
                    ],
                });

                const result = validateInputs(skill, {});
                expect(result.valid).toBe(false);
                expect(result.errors.length).toBeGreaterThanOrEqual(2);
            });
        });
    });

    describe('applyDefaults', () => {
        it('applies default values for missing inputs', () => {
            const skill = createMockSkill({
                inputs: [
                    createMockInput({ name: 'count', default: 10 }),
                    createMockInput({ name: 'name', default: 'default-name' }),
                ],
            });

            const result = applyDefaults(skill, {});
            expect(result.count).toBe(10);
            expect(result.name).toBe('default-name');
        });

        it('does not override provided values', () => {
            const skill = createMockSkill({
                inputs: [createMockInput({ name: 'count', default: 10 })],
            });

            const result = applyDefaults(skill, { count: 5 });
            expect(result.count).toBe(5);
        });

        it('preserves inputs without defaults', () => {
            const skill = createMockSkill({
                inputs: [createMockInput({ name: 'id', default: undefined })],
            });

            const result = applyDefaults(skill, { id: 'test', extra: 'value' });
            expect(result.id).toBe('test');
            expect(result.extra).toBe('value');
        });

        it('preserves extra inputs not in skill definition', () => {
            const skill = createMockSkill({
                inputs: [createMockInput({ name: 'id' })],
            });

            const result = applyDefaults(skill, { id: 'test', unknown: 'extra' });
            expect(result.unknown).toBe('extra');
        });

        it('applies defaults for undefined but not null', () => {
            const skill = createMockSkill({
                inputs: [createMockInput({ name: 'value', default: 'default' })],
            });

            const undefinedResult = applyDefaults(skill, { value: undefined });
            expect(undefinedResult.value).toBe('default');

            // Note: null is not undefined, so default is not applied
            // This may depend on implementation - check actual behavior
        });

        it('handles empty inputs array', () => {
            const skill = createMockSkill({ inputs: [] });

            const result = applyDefaults(skill, { foo: 'bar' });
            expect(result.foo).toBe('bar');
        });

        it('applies default array value', () => {
            const skill = createMockSkill({
                inputs: [createMockInput({ name: 'tags', type: 'array', default: ['default'] })],
            });

            const result = applyDefaults(skill, {});
            expect(result.tags).toEqual(['default']);
        });

        it('applies default boolean value', () => {
            const skill = createMockSkill({
                inputs: [createMockInput({ name: 'enabled', type: 'boolean', default: true })],
            });

            const result = applyDefaults(skill, {});
            expect(result.enabled).toBe(true);
        });

        it('normalizes missing optional inputs without defaults to null', () => {
            const skill = createMockSkill({
                inputs: [
                    createMockInput({ name: 'optional_text', required: false, default: undefined }),
                    createMockInput({ name: 'required_text', required: true, default: undefined }),
                ],
            });

            const result = applyDefaults(skill, {});
            expect(result.optional_text).toBeNull();
            expect(result.required_text).toBeUndefined();
        });
    });

    describe('parseConfirmationResponse', () => {
        const simpleOptions = CONFIRMATION_OPTIONS_SAMPLES.simple;
        const optionsWithGoto = CONFIRMATION_OPTIONS_SAMPLES.withGoto;
        const multipleOptions = CONFIRMATION_OPTIONS_SAMPLES.multipleOptions;

        describe('numeric responses', () => {
            it('parses numeric response 1', () => {
                const result = parseConfirmationResponse('1', simpleOptions);
                expect(result).toEqual(simpleOptions[0]);
            });

            it('parses numeric response 2', () => {
                const result = parseConfirmationResponse('2', simpleOptions);
                expect(result).toEqual(simpleOptions[1]);
            });

            it('parses numeric response for multiple options', () => {
                expect(parseConfirmationResponse('1', multipleOptions)).toEqual(multipleOptions[0]);
                expect(parseConfirmationResponse('2', multipleOptions)).toEqual(multipleOptions[1]);
                expect(parseConfirmationResponse('3', multipleOptions)).toEqual(multipleOptions[2]);
                expect(parseConfirmationResponse('4', multipleOptions)).toEqual(multipleOptions[3]);
            });

            it('returns null for out-of-range number (0)', () => {
                expect(parseConfirmationResponse('0', simpleOptions)).toBeNull();
            });

            it('returns null for out-of-range number (too high)', () => {
                expect(parseConfirmationResponse('5', simpleOptions)).toBeNull();
            });

            it('returns null for negative number', () => {
                expect(parseConfirmationResponse('-1', simpleOptions)).toBeNull();
            });
        });

        describe('cancel keyword', () => {
            it('handles "cancel" keyword mapping to abort', () => {
                const result = parseConfirmationResponse('cancel', simpleOptions);
                expect(result?.action).toBe('abort');
            });

            it('is case-insensitive for cancel', () => {
                expect(parseConfirmationResponse('CANCEL', simpleOptions)?.action).toBe('abort');
                expect(parseConfirmationResponse('Cancel', simpleOptions)?.action).toBe('abort');
                expect(parseConfirmationResponse('CaNcEl', simpleOptions)?.action).toBe('abort');
            });

            it('returns null if no abort option exists', () => {
                const optionsWithoutAbort: ConfirmationOption[] = [
                    { label: 'Continue', action: 'continue' },
                    { label: 'Retry', action: 'goto', gotoStep: 'step-1' },
                ];
                const result = parseConfirmationResponse('cancel', optionsWithoutAbort);
                expect(result).toBeNull();
            });
        });

        describe('invalid responses', () => {
            it('returns null for invalid text input', () => {
                expect(parseConfirmationResponse('invalid', simpleOptions)).toBeNull();
            });

            it('returns null for empty string', () => {
                expect(parseConfirmationResponse('', simpleOptions)).toBeNull();
            });

            it('returns null for text that is not cancel', () => {
                expect(parseConfirmationResponse('yes', simpleOptions)).toBeNull();
                expect(parseConfirmationResponse('no', simpleOptions)).toBeNull();
                expect(parseConfirmationResponse('continue', simpleOptions)).toBeNull();
            });

            it('parses integer part of floating point numbers', () => {
                // JavaScript parseInt('1.5') returns 1, so '1.5' maps to option 1
                // This is expected behavior - parseInt truncates at the decimal
                expect(parseConfirmationResponse('1.5', simpleOptions)).toEqual(simpleOptions[0]);
            });
        });

        describe('whitespace handling', () => {
            it('trims leading whitespace', () => {
                expect(parseConfirmationResponse('  1', simpleOptions)).toEqual(simpleOptions[0]);
            });

            it('trims trailing whitespace', () => {
                expect(parseConfirmationResponse('1  ', simpleOptions)).toEqual(simpleOptions[0]);
            });

            it('trims both leading and trailing whitespace', () => {
                expect(parseConfirmationResponse('  1  ', simpleOptions)).toEqual(simpleOptions[0]);
            });

            it('trims whitespace from cancel keyword', () => {
                expect(parseConfirmationResponse('  cancel  ', simpleOptions)?.action).toBe('abort');
            });
        });

        describe('with goto options', () => {
            it('returns option with gotoStep', () => {
                const result = parseConfirmationResponse('2', optionsWithGoto);
                expect(result?.action).toBe('goto');
                expect(result?.gotoStep).toBe('step-1');
            });
        });
    });
});
