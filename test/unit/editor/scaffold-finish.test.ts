import { describe, expect, it } from 'vitest';
import { finishNote } from '../../../src/editor/scaffold-finish';

describe('finishNote', () => {
    it('is empty for a workspace skill that overrides nothing', () => {
        expect(finishNote({ tier: 'workspace', overridesBuiltin: false })).toBe('');
    });
    it('names the user tier and the override, in that order', () => {
        expect(finishNote({ tier: 'user' })).toBe('(saved to your user skills — no workspace is open)');
        expect(finishNote({ tier: 'workspace', overridesBuiltin: true })).toBe('(overrides the built-in)');
        expect(finishNote({ tier: 'user', overridesBuiltin: true })).toBe(
            '(saved to your user skills — no workspace is open) (overrides the built-in)');
    });
});
