import { describe, it, expect } from 'vitest';
import { snapshotFromCodeAction } from '../../../src/editor/code-action-provider';

// Minimal fakes matching the shape snapshotFromCodeAction reads.
const doc = {
  uri: { fsPath: '/w/a.ts' },
  languageId: 'typescript',
  getText: (range?: unknown) => (range ? 'SELECTED' : 'FULL FILE'),
} as any;

describe('snapshotFromCodeAction', () => {
  it('maps a non-empty selection + active file + diagnostics', () => {
    const range = { isEmpty: false } as any;
    const context = { diagnostics: [{ range: { start: { line: 2 } }, message: 'boom' }] } as any;
    const snap = snapshotFromCodeAction(doc, range, context);
    expect(snap.selection).toBe('SELECTED');
    expect(snap.activeFile).toEqual({ path: '/w/a.ts', content: 'FULL FILE', languageId: 'typescript' });
    expect(snap.diagnostics).toBe('3: boom');
  });

  it('omits selection when the range is empty and diagnostics when none', () => {
    const range = { isEmpty: true } as any;
    const context = { diagnostics: [] } as any;
    const snap = snapshotFromCodeAction(doc, range, context);
    expect(snap.selection).toBeUndefined();
    expect(snap.diagnostics).toBeUndefined();
  });

  it('skips the full-file copy when includeContent is false (path/language/selection still set)', () => {
    const range = { isEmpty: false } as any;
    const context = { diagnostics: [] } as any;
    const snap = snapshotFromCodeAction(doc, range, context, false);
    expect(snap.activeFile).toEqual({ path: '/w/a.ts', content: '', languageId: 'typescript' });
    expect(snap.selection).toBe('SELECTED');
  });
});
