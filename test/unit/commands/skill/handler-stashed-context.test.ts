import { describe, it, expect } from 'vitest';
import { resolveLaunchInputs } from '../../../../src/commands/skill/handler';
import type { Skill } from '../../../../src/skills';
import { LaunchContextStore } from '../../../../src/skills';

function skill(): Skill {
  return {
    id: 'greeter', name: 'G', description: '', version: '1.0.0',
    inputs: [{ name: 'code', type: 'string', description: '', required: true, from: 'selection' }],
    tools: { aliases: {} }, steps: [], onError: 'abort',
    source: { type: 'workspace', path: '/g' },
  } as Skill;
}

describe('resolveLaunchInputs', () => {
  it('uses the stashed snapshot (no live capture) when present', async () => {
    const store = new LaunchContextStore();
    store.set('greeter', { selection: 'STASHED' });
    const out = await resolveLaunchInputs(skill(), {}, store);
    expect(out.code).toBe('STASHED');
    // consumed: a second call falls back (empty snapshot via no accessors → required stays empty)
    const out2 = await resolveLaunchInputs(skill(), {}, store, async () => ({}));
    expect(out2.code).toBeUndefined();
  });

  it('falls back to live capture when nothing is stashed', async () => {
    const store = new LaunchContextStore();
    const out = await resolveLaunchInputs(skill(), {}, store, async () => ({ code: 'LIVE' }));
    expect(out.code).toBe('LIVE');
  });

  it('coerces a from:-filled value to the declared type (D11)', async () => {
    const s = { ...skill(), inputs: [{ name: 'n', type: 'number', description: '', required: false, from: 'selection' }] } as Skill;
    const store = new LaunchContextStore();
    store.set('greeter', { selection: '42' });
    const out = await resolveLaunchInputs(s, {}, store);
    expect(out.n).toBe(42);
  });

  it('drops a from:-filled value the input would reject instead of hard-failing (D12)', async () => {
    const s = { ...skill(), inputs: [{ name: 'lang', type: 'string', description: '', required: false, from: 'selection', enum: ['ts', 'js'] }] } as Skill;
    const store = new LaunchContextStore();
    store.set('greeter', { selection: 'python' });
    const out = await resolveLaunchInputs(s, {}, store);
    expect(out.lang).toBeUndefined();
  });

  it('drops a non-boolean selection bound to a boolean input instead of coercing it to false (D13)', async () => {
    const s = { ...skill(), inputs: [{ name: 'flag', type: 'boolean', description: '', required: false, from: 'selection' }] } as Skill;
    const store = new LaunchContextStore();
    store.set('greeter', { selection: 'function foo() { return 1; }' });
    const out = await resolveLaunchInputs(s, {}, store);
    expect(out.flag).toBeUndefined(); // NOT false — a code blob is not a boolean
  });

  it('keeps a genuinely boolean selection bound to a boolean input (D13)', async () => {
    const s = { ...skill(), inputs: [{ name: 'flag', type: 'boolean', description: '', required: false, from: 'selection' }] } as Skill;
    const store = new LaunchContextStore();
    store.set('greeter', { selection: 'true' });
    const out = await resolveLaunchInputs(s, {}, store);
    expect(out.flag).toBe(true);
  });
});
