import { describe, it, expect } from 'vitest';
import { captureSnapshot, resolveInputs, SNAPSHOT_PROVIDERS } from '../../../../src/skills/context/resolver';
import { KNOWN_CONTEXT_SOURCES } from '../../../../src/skills/context/sources';
import type { ContextAccessors, EditorContextSnapshot } from '../../../../src/skills/context/types';
import type { Skill, SkillInput } from '../../../../src/skills/types';

function skillWith(inputs: Partial<SkillInput>[]): Skill {
  return {
    id: 't', name: 'T', description: '', version: '1.0.0',
    inputs: inputs.map(i => ({ name: i.name!, type: 'string', description: '', required: i.required ?? true, ...i })),
    tools: { aliases: {} }, steps: [], onError: 'abort',
    source: { type: 'workspace', path: '/t' },
  } as Skill;
}

const SNAP: EditorContextSnapshot = { selection: 'SEL', activeFile: { path: '/a.ts', content: 'C', languageId: 'ts' } };

describe('resolveInputs', () => {
  it('fills an empty from-bound input from the snapshot', () => {
    const skill = skillWith([{ name: 'code', from: 'selection' }]);
    const out = resolveInputs(skill, {}, SNAP);
    expect(out.code).toBe('SEL');
  });

  it('does not overwrite an explicitly provided value', () => {
    const skill = skillWith([{ name: 'code', from: 'selection' }]);
    const out = resolveInputs(skill, { code: 'EXPLICIT' }, SNAP);
    expect(out.code).toBe('EXPLICIT');
  });

  it('leaves a required input empty when the source is absent (so it gets prompted)', () => {
    const skill = skillWith([{ name: 'code', from: 'selection', required: true }]);
    const out = resolveInputs(skill, {}, {} /* empty snapshot */);
    expect(out.code).toBeUndefined();
  });

  it('ignores inputs without a from binding', () => {
    const skill = skillWith([{ name: 'plain' }]);
    const out = resolveInputs(skill, {}, SNAP);
    expect(out.plain).toBeUndefined();
  });
});

describe('captureSnapshot', () => {
  it('builds a snapshot from accessors', async () => {
    const accessors: ContextAccessors = {
      getActiveFile: () => ({ path: '/a.ts', content: 'C', languageId: 'ts', selection: 'SEL' }),
      getGitDiff: async (staged) => (staged ? 'STAGED' : 'WORKING'),
      getDiagnostics: () => 'DIAG',
    };
    const snap = await captureSnapshot(accessors);
    expect(snap.selection).toBe('SEL');
    expect(snap.activeFile).toEqual({ path: '/a.ts', content: 'C', languageId: 'ts' });
    expect(snap.gitStaged).toBe('STAGED');
    expect(snap.gitWorking).toBe('WORKING');
    expect(snap.diagnostics).toBe('DIAG');
  });

  it('yields an empty snapshot when nothing is available', async () => {
    const accessors: ContextAccessors = {
      getActiveFile: () => undefined,
      getGitDiff: async () => undefined,
      getDiagnostics: () => undefined,
    };
    const snap = await captureSnapshot(accessors);
    expect(snap).toEqual({});
  });

  it('captures only the sources requested — skips the git diffs a selection-only skill never reads', async () => {
    let gitCalls = 0;
    let diagCalls = 0;
    const accessors: ContextAccessors = {
      getActiveFile: () => ({ path: '/a.ts', content: 'C', languageId: 'ts', selection: 'SEL' }),
      getGitDiff: async (staged) => { gitCalls++; return staged ? 'STAGED' : 'WORKING'; },
      getDiagnostics: () => { diagCalls++; return 'DIAG'; },
    };
    const snap = await captureSnapshot(accessors, new Set(['selection']));
    expect(gitCalls).toBe(0);          // no git subprocess for a selection-only binding
    expect(diagCalls).toBe(0);
    expect(snap.selection).toBe('SEL');
    expect(snap.gitStaged).toBeUndefined();
    expect(snap.gitWorking).toBeUndefined();
  });

  it('runs only the git diff a git-bound skill requests', async () => {
    const staged: boolean[] = [];
    const accessors: ContextAccessors = {
      getActiveFile: () => undefined,
      getGitDiff: async (s) => { staged.push(s); return s ? 'STAGED' : 'WORKING'; },
      getDiagnostics: () => undefined,
    };
    const snap = await captureSnapshot(accessors, new Set(['git.staged']));
    expect(staged).toEqual([true]);    // only the staged diff, not the working-tree one
    expect(snap.gitStaged).toBe('STAGED');
    expect(snap.gitWorking).toBeUndefined();
  });
});

describe('SNAPSHOT_PROVIDERS registry integrity', () => {
  const owned = SNAPSHOT_PROVIDERS.flatMap(p => p.owns);

  it('only owns known context sources', () => {
    for (const s of owned) expect(KNOWN_CONTEXT_SOURCES.has(s)).toBe(true);
  });

  it('captures every known context source via exactly one provider', () => {
    for (const s of KNOWN_CONTEXT_SOURCES) {
      expect(owned.filter(o => o === s)).toHaveLength(1);
    }
  });
});
