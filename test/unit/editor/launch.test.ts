import { describe, it, expect } from 'vitest';
import { buildSkillQuery, runSurfaceToPartialQuery, launchSkill } from '../../../src/editor/launch';
import type { EditorContextSnapshot } from '../../../src/skills';

describe('buildSkillQuery', () => {
  it('builds the @skiller /skill query', () => {
    expect(buildSkillQuery('greeter')).toBe('@skiller /skill greeter');
  });
});

describe('runSurfaceToPartialQuery', () => {
  it('chat submits immediately (false)', () => {
    expect(runSurfaceToPartialQuery('chat')).toBe(false);
  });
  it('adaptive prefills and waits (true)', () => {
    expect(runSurfaceToPartialQuery('adaptive')).toBe(true);
  });
});

describe('launchSkill', () => {
  it('stashes the snapshot and opens chat with the query + surface flag', async () => {
    const snap: EditorContextSnapshot = { selection: 'X' };
    const calls: Record<string, unknown> = {};
    await launchSkill('greeter', snap, {
      stashContext: (id, s) => { calls.stashedId = id; calls.stashedSnap = s; },
      getRunSurface: () => 'chat',
      openChat: async (query, isPartialQuery) => { calls.query = query; calls.partial = isPartialQuery; },
    });
    expect(calls.stashedId).toBe('greeter');
    expect(calls.stashedSnap).toEqual(snap);
    expect(calls.query).toBe('@skiller /skill greeter');
    expect(calls.partial).toBe(false);
  });
});
