import { describe, it, expect } from 'vitest';
import { resolveContextInputs } from '../../../../src/skills/context/resolver';
import type { ContextAccessors } from '../../../../src/skills/context/types';
import type { Skill } from '../../../../src/skills/types';

function skill(inputsHaveFrom: boolean): Skill {
  return {
    id: 't', name: 'T', description: '', version: '1.0.0',
    inputs: [{ name: 'code', type: 'string', description: '', required: true, ...(inputsHaveFrom ? { from: 'selection' } : {}) }],
    tools: { aliases: {} }, steps: [], onError: 'abort',
    source: { type: 'workspace', path: '/t' },
  } as Skill;
}

const fakeAccessors: ContextAccessors = {
  getActiveFile: () => ({ path: '/a.ts', content: 'C', languageId: 'ts', selection: 'SEL' }),
  getGitDiff: async () => undefined,
  getDiagnostics: () => undefined,
};

describe('resolveContextInputs', () => {
  it('captures + resolves when an input has from:', async () => {
    const out = await resolveContextInputs(skill(true), {}, fakeAccessors);
    expect(out.code).toBe('SEL');
  });

  it('fast-paths (returns inputs unchanged, no capture) when no input has from:', async () => {
    let captured = false;
    const spy: ContextAccessors = { ...fakeAccessors, getActiveFile: () => { captured = true; return undefined; } };
    const inputs = { code: 'X' };
    const out = await resolveContextInputs(skill(false), inputs, spy);
    expect(out).toBe(inputs);          // same reference — untouched
    expect(captured).toBe(false);      // no editor read
  });
});
