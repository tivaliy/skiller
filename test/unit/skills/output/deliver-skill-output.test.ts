import { describe, it, expect } from 'vitest';
import { deliverSkillOutput, stripCodeFence } from '../../../../src/skills/output/deliver-skill-output';
import type { OutputDeps } from '../../../../src/skills/output/types';
import type { Skill, SkillResult } from '../../../../src/skills';

function skill(to?: string): Skill {
  return {
    id: 't', name: 'T', description: '', version: '1.0.0',
    inputs: [], tools: { aliases: {} }, steps: [], onError: 'abort',
    output: to ? { summary: '...', to } : { summary: '...' },
    source: { type: 'workspace', path: '/t' },
  } as Skill;
}

function result(summary?: string): SkillResult {
  return { skillId: 't', success: true, steps: [], context: { inputs: {}, outputs: {} } as never, duration: 1, summary } as SkillResult;
}

function recordingDeps(overrides: Partial<OutputDeps> = {}) {
  const calls: Record<string, unknown> = {};
  const deps: OutputDeps = {
    openNewDocument: async (c) => { calls.newDocument = c; },
    writeFile: async (p, c) => { calls.file = { p, c }; },
    replaceSelection: async (c) => { calls.replaceSelection = c; },
    insertAtCursor: async (c) => { calls.insert = c; },
    showDiff: async (c) => { calls.diff = c; },
    sendToTerminal: async (c) => { calls.terminal = c; },
    runInTerminal: async (c) => { calls.terminalRun = c; },
    ...overrides,
  };
  return { deps, calls };
}

describe('deliverSkillOutput', () => {
  it('delivers the rendered summary to the configured sink and reports delivered', async () => {
    const { deps, calls } = recordingDeps();
    const outcome = await deliverSkillOutput(skill('newDocument'), result('HELLO'), deps);
    expect(calls.newDocument).toBe('HELLO');
    expect(outcome).toEqual({ kind: 'delivered', sink: { kind: 'newDocument' } });
  });

  it('is a no-op when no output.to is set', async () => {
    const { deps, calls } = recordingDeps();
    const outcome = await deliverSkillOutput(skill(undefined), result('HELLO'), deps);
    expect(Object.keys(calls)).toHaveLength(0);
    expect(outcome).toEqual({ kind: 'none' });
  });

  it('reports an unrecognized target without delivering', async () => {
    const { deps, calls } = recordingDeps();
    const outcome = await deliverSkillOutput(skill('bogus'), result('HELLO'), deps);
    expect(Object.keys(calls)).toHaveLength(0);
    expect(outcome).toEqual({ kind: 'unknownSink', to: 'bogus' });
  });

  it('does NOT write empty content into a sink (guards against data loss)', async () => {
    const { deps, calls } = recordingDeps();
    const outcome = await deliverSkillOutput(skill('editor.replaceSelection'), result(undefined), deps);
    expect(Object.keys(calls)).toHaveLength(0);
    expect(outcome).toEqual({ kind: 'none' });
  });

  it('is a no-op for a failed result', async () => {
    const { deps, calls } = recordingDeps();
    const failed = { ...result('HELLO'), success: false } as SkillResult;
    const outcome = await deliverSkillOutput(skill('newDocument'), failed, deps);
    expect(Object.keys(calls)).toHaveLength(0);
    expect(outcome).toEqual({ kind: 'none' });
  });

  it('strips a wrapping code fence before delivering', async () => {
    const { deps, calls } = recordingDeps();
    await deliverSkillOutput(skill('editor.replaceSelection'), result('```ts\nconst x = 1;\n```'), deps);
    expect(calls.replaceSelection).toBe('const x = 1;');
  });

  it('reports failed (without throwing) when a sink throws', async () => {
    const { deps } = recordingDeps({ writeFile: async () => { throw new Error('refused'); } });
    const outcome = await deliverSkillOutput(skill('file:out.md'), result('BODY'), deps);
    expect(outcome).toEqual({ kind: 'failed', message: 'refused' });
  });

  it('interpolates a templated file path against the run context', async () => {
    const { deps, calls } = recordingDeps();
    const r = {
      skillId: 't', success: true, steps: [], duration: 1, summary: 'BODY',
      context: { inputs: { name: 'report' }, outputs: {} },
    } as unknown as SkillResult;
    await deliverSkillOutput(skill('file:out/{{ inputs.name }}.md'), r, deps);
    expect(calls.file).toEqual({ p: 'out/report.md', c: 'BODY' });
  });

  it('degrades a templated path with an undefined variable to empty instead of throwing', async () => {
    const { deps, calls } = recordingDeps();
    // strict interpolation would throw on the undefined var; non-strict renders empty.
    const outcome = await deliverSkillOutput(skill('file:out/{{ outputs.missing }}.md'), result('BODY'), deps);
    expect(calls.file).toEqual({ p: 'out/.md', c: 'BODY' });
    expect(outcome).toEqual({ kind: 'delivered', sink: { kind: 'file', path: 'out/.md' } });
  });
});

describe('stripCodeFence', () => {
  it('strips a ```lang ... ``` wrapper', () => {
    expect(stripCodeFence('```python\nx = 1\n```')).toBe('x = 1');
  });
  it('strips a bare ``` ... ``` wrapper', () => {
    expect(stripCodeFence('```\nhello\n```')).toBe('hello');
  });
  it('leaves unfenced content untouched', () => {
    expect(stripCodeFence('const x = 1;')).toBe('const x = 1;');
  });
  it('leaves content with only an inner fence untouched', () => {
    expect(stripCodeFence('text\n```\ncode\n```\nmore')).toBe('text\n```\ncode\n```\nmore');
  });
  it('strips a CRLF-fenced wrapper without leaving a trailing carriage return', () => {
    expect(stripCodeFence('```ts\r\nconst x = 1;\r\n```')).toBe('const x = 1;');
  });
  it('preserves internal CRLF line endings but drops the dangling one before the fence', () => {
    expect(stripCodeFence('```ts\r\nconst x = 1;\r\nconst y = 2;\r\n```')).toBe('const x = 1;\r\nconst y = 2;');
  });
});
