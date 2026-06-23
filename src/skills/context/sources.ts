/**
 * Context Sources
 *
 * Pure mapping from a `from:` expression to a value in an EditorContextSnapshot.
 * Unknown expressions return undefined (the input falls back to prompting).
 */

import type { ContextSource, EditorContextSnapshot } from './types';

const CONTEXT_SOURCES: Record<string, ContextSource> = {
    'selection': s => s.selection,
    'activeFile': s => s.activeFile?.content,        // bare activeFile defaults to content
    'activeFile.path': s => s.activeFile?.path,
    'activeFile.content': s => s.activeFile?.content,
    'activeFile.language': s => s.activeFile?.languageId,
    'git.staged': s => s.gitStaged,
    'git.working': s => s.gitWorking,
    'diagnostics': s => s.diagnostics,
};

/** All recognized `from:` source names. */
export const KNOWN_CONTEXT_SOURCES = new Set(Object.keys(CONTEXT_SOURCES));

/**
 * The `from:` sources backed by the active file's full text. Kept beside
 * CONTEXT_SOURCES so the "what reads the whole file" knowledge lives in one place:
 * the code-action provider gates its costly full-file copy on whether any skill
 * binds one of these (path / language / selection / diagnostics are all cheap).
 */
export const FILE_CONTENT_SOURCES: ReadonlySet<string> = new Set(['activeFile', 'activeFile.content']);

/** Resolve a `from:` expression against a snapshot; undefined if unknown/absent. */
export function resolveSource(from: string, snapshot: EditorContextSnapshot): string | undefined {
    const source = CONTEXT_SOURCES[from];
    return source ? source(snapshot) : undefined;
}

/** Format diagnostics into the snapshot's one-per-line `<line>: <message>` string. */
export function formatDiagnostics(
    diagnostics: ReadonlyArray<{ range: { start: { line: number } }; message: string }>
): string {
    return diagnostics.map(d => `${d.range.start.line + 1}: ${d.message}`).join('\n');
}
