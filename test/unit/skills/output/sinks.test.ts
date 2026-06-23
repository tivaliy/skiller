import { describe, it, expect } from 'vitest';
import { parseSink, deliverOutput, describeSink } from '../../../../src/skills/output/sinks';
import type { OutputDeps } from '../../../../src/skills/output/types';

describe('parseSink', () => {
  it('parses each sink target', () => {
    expect(parseSink('newDocument')).toEqual({ kind: 'newDocument' });
    expect(parseSink('editor.replaceSelection')).toEqual({ kind: 'replaceSelection' });
    expect(parseSink('editor.insert')).toEqual({ kind: 'insert' });
    expect(parseSink('diff')).toEqual({ kind: 'diff' });
    expect(parseSink('terminal')).toEqual({ kind: 'terminal' });
    expect(parseSink('terminal.run')).toEqual({ kind: 'terminalRun' });
    expect(parseSink('file:out/report.md')).toEqual({ kind: 'file', path: 'out/report.md' });
  });

  it('returns undefined for absent or unknown targets', () => {
    expect(parseSink(undefined)).toBeUndefined();
    expect(parseSink('bogus')).toBeUndefined();
    expect(parseSink('file:')).toBeUndefined(); // empty path is not a valid file sink
  });
});

describe('deliverOutput', () => {
  function recordingDeps() {
    const calls: Record<string, unknown> = {};
    const deps: OutputDeps = {
      openNewDocument: async (c) => { calls.newDocument = c; },
      writeFile: async (p, c) => { calls.file = { path: p, content: c }; },
      replaceSelection: async (c) => { calls.replaceSelection = c; },
      insertAtCursor: async (c) => { calls.insert = c; },
      showDiff: async (c) => { calls.diff = c; },
      sendToTerminal: async (c) => { calls.terminal = c; },
      runInTerminal: async (c) => { calls.terminalRun = c; },
    };
    return { deps, calls };
  }

  it('routes each sink kind to the matching dep', async () => {
    const { deps, calls } = recordingDeps();
    await deliverOutput('A', { kind: 'newDocument' }, deps);
    await deliverOutput('B', { kind: 'file', path: 'a.md' }, deps);
    await deliverOutput('C', { kind: 'replaceSelection' }, deps);
    await deliverOutput('D', { kind: 'insert' }, deps);
    await deliverOutput('E', { kind: 'diff' }, deps);
    await deliverOutput('F', { kind: 'terminal' }, deps);
    await deliverOutput('G', { kind: 'terminalRun' }, deps);
    expect(calls.newDocument).toBe('A');
    expect(calls.file).toEqual({ path: 'a.md', content: 'B' });
    expect(calls.replaceSelection).toBe('C');
    expect(calls.insert).toBe('D');
    expect(calls.diff).toBe('E');
    expect(calls.terminal).toBe('F');
    expect(calls.terminalRun).toBe('G');
  });
});

describe('describeSink', () => {
  it('describes each sink kind for the delivery confirmation', () => {
    expect(describeSink({ kind: 'newDocument' })).toMatch(/new document/);
    expect(describeSink({ kind: 'terminal' })).toMatch(/terminal/);
    expect(describeSink({ kind: 'terminalRun' })).toMatch(/terminal/);
    expect(describeSink({ kind: 'file', path: 'a.md' })).toContain('a.md');
  });
});
