import { describe, it, expect, vi } from 'vitest';
import { resolveSource, formatToolList, AMBIENT_SOURCES, KNOWN_CONTEXT_SOURCES } from '../../../../src/skills/context/sources';
import { captureSnapshot } from '../../../../src/skills/context/resolver';
import type { ContextAccessors } from '../../../../src/skills/context/types';

function fakeAccessors(): ContextAccessors {
  return {
    getActiveFile: vi.fn(() => undefined),
    getGitDiff: vi.fn(async () => undefined),
    getDiagnostics: vi.fn(() => undefined),
    getTools: vi.fn(() => 'a — b'),
  };
}

describe('tools source', () => {
  it('is a known ambient source', () => {
    expect(KNOWN_CONTEXT_SOURCES.has('tools')).toBe(true);
    expect(AMBIENT_SOURCES.has('tools')).toBe(true);
  });

  it('resolves from the snapshot', () => {
    expect(resolveSource('tools', { tools: 'a — b' })).toBe('a — b');
  });

  it('formats one line per tool and drops unusable tools', () => {
    const out = formatToolList([
      { name: 'x_tool', description: 'Does X' },
      { name: 'copilot_createFile', description: '…' },
      { name: 'search_subagent', description: '…' },
      { name: 'skiller_writeSkill', description: '…' },
    ]);
    expect(out).toBe('x_tool — Does X');
  });

  it('truncates long descriptions to 160 chars plus an ellipsis', () => {
    const out = formatToolList([{ name: 't', description: 'z'.repeat(200) }]);
    expect(out).toBe(`t — ${'z'.repeat(160)}…`);
  });

  it('collapses a multi-line description to one line', () => {
    const out = formatToolList([{ name: 't', description: 'First line.\n\n  Second\tline.  \r\nThird.' }]);
    expect(out).toBe('t — First line. Second line. Third.');
  });

  it('collapses whitespace before truncating, so the cut counts visible text', () => {
    const out = formatToolList([{ name: 't', description: `${'a\n'.repeat(100)}` }]);
    expect(out).toBe(`t — ${'a '.repeat(80).slice(0, 160)}…`);
  });

  it('never splits a surrogate pair at the truncation boundary', () => {
    // The emoji straddles UTF-16 index 160 (code units 159-160).
    const out = formatToolList([{ name: 't', description: `${'z'.repeat(159)}😀${'y'.repeat(20)}` }]);
    expect(out).toBe(`t — ${'z'.repeat(159)}😀…`);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('returns undefined for an empty list', () => {
    expect(formatToolList([])).toBeUndefined();
  });

  it('captureSnapshot calls only getTools for tools', async () => {
    const a = fakeAccessors();
    const snap = await captureSnapshot(a, new Set(['tools']));
    expect(snap.tools).toBe('a — b');
    expect(a.getTools).toHaveBeenCalledTimes(1);
    expect(a.getActiveFile).not.toHaveBeenCalled();
    expect(a.getGitDiff).not.toHaveBeenCalled();
  });

  it('captureSnapshot never calls getTools for other sources', async () => {
    const a = fakeAccessors();
    await captureSnapshot(a, new Set(['selection']));
    expect(a.getTools).not.toHaveBeenCalled();
  });
});
