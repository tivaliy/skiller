/**
 * Tests for the /skill argument parser (S-23: quoting + positional indexing).
 */

import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../../src/commands/skill/argument-parser';

describe('parseArgs', () => {
    it('parses skill id with no args', () => {
        expect(parseArgs('greeter')).toEqual({ skillId: 'greeter', params: {} });
    });

    it('parses named args', () => {
        const { skillId, params } = parseArgs('my-skill foo=bar baz=qux');
        expect(skillId).toBe('my-skill');
        expect(params).toMatchObject({ foo: 'bar', baz: 'qux' });
    });

    it('keeps quoted values with spaces as a single named value', () => {
        const { params } = parseArgs('my-skill msg="hello world"');
        expect(params.msg).toBe('hello world');
    });

    it('keeps single-quoted positional values with spaces intact', () => {
        const { params } = parseArgs("my-skill 'two words' second");
        expect(params._arg1).toBe('two words');
        expect(params._arg2).toBe('second');
    });

    it('numbers positionals in order even when interleaved with named args', () => {
        // Regression: a named arg used to leave a gap that dropped later positionals.
        const { params } = parseArgs('my-skill alpha foo=bar beta');
        expect(params._arg1).toBe('alpha');
        expect(params._arg2).toBe('beta');
        expect(params.foo).toBe('bar');
    });

    it('preserves "=" inside a value', () => {
        const { params } = parseArgs('my-skill expr=a=b+c');
        expect(params.expr).toBe('a=b+c');
    });

    it('treats a leading "=" token as positional, not an empty-key named arg', () => {
        const { params } = parseArgs('my-skill =bar');
        expect(params._arg1).toBe('=bar');
        expect(params['']).toBeUndefined();
    });
});
