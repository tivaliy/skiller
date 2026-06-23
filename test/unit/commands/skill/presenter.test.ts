import { describe, it, expect } from 'vitest';
import { defaultInputPrompt } from '../../../../src/commands/skill/presenter';
import type { SkillInput } from '../../../../src/skills';

function input(over: Partial<SkillInput>): SkillInput {
  return { name: 'diff', type: 'string', description: '', required: true, ...over } as SkillInput;
}

describe('defaultInputPrompt', () => {
  it('names the from: source when a context-bound input falls back to prompting', () => {
    // A from:-input is only ever prompted when its source resolved empty, so the
    // fallback should say it couldn't auto-fill and from where — not a bare "provide X".
    const text = defaultInputPrompt(input({ from: 'git.staged' }));
    expect(text).toContain('git.staged');
    expect(text).toContain('auto-fill');
    expect(text).toContain('diff');
  });

  it('uses the plain prompt for a non-context input', () => {
    expect(defaultInputPrompt(input({}))).toBe('Please provide **diff** (string):');
  });

  it('reflects the declared type in the plain prompt', () => {
    expect(defaultInputPrompt(input({ name: 'count', type: 'number' }))).toBe(
      'Please provide **count** (number):'
    );
  });
});
