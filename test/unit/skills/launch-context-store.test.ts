import { describe, it, expect } from 'vitest';
import { LaunchContextStore } from '../../../src/skills';
import type { EditorContextSnapshot, DeliveryTarget } from '../../../src/skills';

const SNAP: EditorContextSnapshot = { selection: 'SEL' };
const TARGET: DeliveryTarget = {
  uri: 'file:///x.ts',
  version: 1,
  selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
};

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
    store.setTarget('a', TARGET);
    store.clear();
    expect(store.take('a')).toBeUndefined();
    expect(store.takeTarget('a')).toBeUndefined();
  });

  it('stashes and consumes a delivery target independently of the snapshot', () => {
    const store = new LaunchContextStore();
    store.set('s', SNAP);
    store.setTarget('s', TARGET);
    expect(store.hasTarget('s')).toBe(true);
    // Taking the snapshot (input resolution) must NOT drop the target — output is
    // delivered later in the run, possibly several turns later.
    expect(store.take('s')).toEqual(SNAP);
    expect(store.hasTarget('s')).toBe(true);
    expect(store.takeTarget('s')).toEqual(TARGET);
    expect(store.takeTarget('s')).toBeUndefined(); // consumed
    expect(store.hasTarget('s')).toBe(false);
  });

  it('expires a stash that outlives the TTL (cross-run leak guard)', () => {
    let clock = 1000;
    const store = new LaunchContextStore(60_000, () => clock);
    store.set('s', SNAP);
    store.setTarget('s', TARGET);
    clock += 60_001; // advance past the TTL
    expect(store.take('s')).toBeUndefined();
    expect(store.takeTarget('s')).toBeUndefined();
    expect(store.hasTarget('s')).toBe(false);
  });

  it('refreshes the TTL when the snapshot is consumed, keeping the target alive through a long run', () => {
    let clock = 0;
    const store = new LaunchContextStore(60_000, () => clock);
    store.set('s', SNAP);
    store.setTarget('s', TARGET);
    clock = 50_000;                          // still within the TTL window
    expect(store.take('s')).toEqual(SNAP);   // consuming the snapshot marks the run as live → refreshes stashedAt
    clock = 100_000;                         // 100s since the trigger, but only 50s since the run started consuming
    // Without the refresh the entry would have expired at 60s and the editor sink
    // would silently fall back to a new document mid-confirmation. With it, the target survives.
    expect(store.takeTarget('s')).toEqual(TARGET);
  });
});
