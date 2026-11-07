import { describe, it, expect } from 'vitest';
import { LaunchContextStore } from '../../../src/skills';
import type { EditorContextSnapshot } from '../../../src/skills';

const SNAP: EditorContextSnapshot = { selection: 'SEL' };

describe('LaunchContextStore', () => {
  it('takes back the stashed snapshot once, then forgets it', () => {
    const store = new LaunchContextStore();
    store.set('greeter', SNAP);
    expect(store.take('greeter')).toEqual(SNAP);
    expect(store.take('greeter')).toBeUndefined(); // consumed
  });

  it('returns undefined for an unstashed skill', () => {
    expect(new LaunchContextStore().take('nope')).toBeUndefined();
  });

  it('clear() drops all stashed state', () => {
    const store = new LaunchContextStore();
    store.set('a', SNAP);
    store.clear();
    expect(store.take('a')).toBeUndefined();
  });

  it('expires a stash that outlives the TTL (cross-run leak guard)', () => {
    let clock = 1000;
    const store = new LaunchContextStore(60_000, () => clock);
    store.set('s', SNAP);
    clock += 60_001; // advance past the TTL
    expect(store.take('s')).toBeUndefined();
  });

  it('a re-stash replaces the snapshot and restarts the TTL', () => {
    let clock = 0;
    const store = new LaunchContextStore(60_000, () => clock);
    store.set('s', { selection: 'old' });
    clock = 50_000;
    store.set('s', SNAP);
    clock = 100_000; // 100s since the first stash, 50s since the second
    expect(store.take('s')).toEqual(SNAP);
  });
});
