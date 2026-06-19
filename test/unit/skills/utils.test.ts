/**
 * Tests for shared skill utilities. Covers formatDuration (extracted from
 * progress-hooks / step-inspection so both render durations identically).
 */

import { describe, it, expect } from 'vitest';
import { formatDuration, fence } from '../../../src/skills/utils';

describe('formatDuration', () => {
    it('formats sub-second durations in milliseconds', () => {
        expect(formatDuration(5)).toBe('5ms');
        expect(formatDuration(999)).toBe('999ms');
    });

    it('formats durations of a second or more in seconds', () => {
        expect(formatDuration(1000)).toBe('1.0s');
        expect(formatDuration(1500)).toBe('1.5s');
    });

    it('clamps invalid (negative / non-finite) durations to 0ms', () => {
        expect(formatDuration(-5)).toBe('0ms');
        expect(formatDuration(NaN)).toBe('0ms');
    });
});

describe('fence', () => {
    it('wraps text in a triple-backtick code block', () => {
        expect(fence('hello')).toBe('```\nhello\n```');
    });

    it('neutralizes inner code fences so content cannot break out', () => {
        expect(fence('a ``` b')).toBe('```\na ` ` ` b\n```');
    });
});
