import { describe, it, expect } from 'vitest';
import { resolveSource, KNOWN_CONTEXT_SOURCES } from '../../../../src/skills/context/sources';
import type { EditorContextSnapshot } from '../../../../src/skills/context/types';

const SNAP: EditorContextSnapshot = {
  selection: 'const x = 1;',
  activeFile: { path: '/w/a.ts', content: 'full file', languageId: 'typescript' },
  gitStaged: 'diff --git staged',
  gitWorking: 'diff --git working',
  diagnostics: '3: Cannot find name',
};

describe('resolveSource', () => {
  it('resolves each known source', () => {
    expect(resolveSource('selection', SNAP)).toBe('const x = 1;');
    expect(resolveSource('activeFile', SNAP)).toBe('full file');        // defaults to content
    expect(resolveSource('activeFile.path', SNAP)).toBe('/w/a.ts');
    expect(resolveSource('activeFile.content', SNAP)).toBe('full file');
    expect(resolveSource('activeFile.language', SNAP)).toBe('typescript');
    expect(resolveSource('git.staged', SNAP)).toBe('diff --git staged');
    expect(resolveSource('git.working', SNAP)).toBe('diff --git working');
    expect(resolveSource('diagnostics', SNAP)).toBe('3: Cannot find name');
  });

  it('returns undefined for unknown sources', () => {
    expect(resolveSource('bogus', SNAP)).toBeUndefined();
  });

  it('returns undefined when the snapshot lacks the data', () => {
    expect(resolveSource('selection', {})).toBeUndefined();
    expect(resolveSource('activeFile.path', {})).toBeUndefined();
  });

  it('exposes the known source names', () => {
    expect(KNOWN_CONTEXT_SOURCES.has('selection')).toBe(true);
    expect(KNOWN_CONTEXT_SOURCES.has('git.staged')).toBe(true);
  });
});
