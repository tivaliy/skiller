import { describe, it, expect } from 'vitest';
import { skillMatchesContext, anySkillBindsContext, anySkillBindsFileContent } from '../../../src/editor/matching';
import type { Skill, SkillInput } from '../../../src/skills';
import type { EditorContextSnapshot } from '../../../src/skills';

function skill(inputs: Partial<SkillInput>[]): Skill {
  return {
    id: 't', name: 'T', description: '', version: '1.0.0',
    inputs: inputs.map(i => ({ name: i.name!, type: 'string', description: '', required: true, ...i })),
    tools: { aliases: {} }, steps: [], onError: 'abort',
    source: { type: 'workspace', path: '/t' },
  } as Skill;
}

describe('skillMatchesContext', () => {
  it('matches when a from-bound input resolves in the snapshot', () => {
    const snap: EditorContextSnapshot = { selection: 'SEL' };
    expect(skillMatchesContext(skill([{ name: 'code', from: 'selection' }]), snap)).toBe(true);
  });
  it('does not match when no from-bound input resolves', () => {
    const snap: EditorContextSnapshot = {}; // no selection
    expect(skillMatchesContext(skill([{ name: 'code', from: 'selection' }]), snap)).toBe(false);
  });
  it('does not match a skill with no from-bound inputs', () => {
    const snap: EditorContextSnapshot = { selection: 'SEL' };
    expect(skillMatchesContext(skill([{ name: 'plain' }]), snap)).toBe(false);
  });
});

describe('anySkillBindsContext', () => {
  it('is true when at least one skill declares a from: input', () => {
    expect(anySkillBindsContext([skill([{ name: 'plain' }]), skill([{ name: 'code', from: 'selection' }])])).toBe(true);
  });
  it('is false when no installed skill binds editor context (lets the provider skip snapshotting)', () => {
    expect(anySkillBindsContext([skill([{ name: 'plain' }]), skill([{ name: 'x' }])])).toBe(false);
  });
  it('is false for an empty registry', () => {
    expect(anySkillBindsContext([])).toBe(false);
  });
});

describe('anySkillBindsFileContent', () => {
  it('is true when a skill binds activeFile.content or bare activeFile', () => {
    expect(anySkillBindsFileContent([skill([{ name: 'c', from: 'activeFile.content' }])])).toBe(true);
    expect(anySkillBindsFileContent([skill([{ name: 'c', from: 'activeFile' }])])).toBe(true);
  });
  it('is false when only cheap sources are bound (no whole-file copy needed)', () => {
    expect(anySkillBindsFileContent([
      skill([{ name: 'sel', from: 'selection' }]),
      skill([{ name: 'd', from: 'diagnostics' }]),
      skill([{ name: 'p', from: 'activeFile.path' }]),
    ])).toBe(false);
  });
  it('is false when no skill binds context', () => {
    expect(anySkillBindsFileContent([skill([{ name: 'plain' }])])).toBe(false);
  });
});
