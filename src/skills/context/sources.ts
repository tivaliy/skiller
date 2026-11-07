/**
 * Context Sources
 *
 * Pure mapping from a `from:` expression to a value in an EditorContextSnapshot.
 * Unknown expressions return undefined (the input falls back to prompting).
 */

import type { ContextSource, EditorContextSnapshot } from './types';
import { BUILTIN_ONLY_TOOLS, CHAT_ONLY_TOOLS } from '../tool-policy';

const CONTEXT_SOURCES: Record<string, ContextSource> = {
    'selection': s => s.selection,
    'activeFile': s => s.activeFile?.content,        // bare activeFile defaults to content
    'activeFile.path': s => s.activeFile?.path,
    'activeFile.content': s => s.activeFile?.content,
    'activeFile.language': s => s.activeFile?.languageId,
    'git.staged': s => s.gitStaged,
    'git.working': s => s.gitWorking,
    'diagnostics': s => s.diagnostics,
    'tools': s => s.tools,
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

/**
 * Sources that describe the environment rather than what the user is looking at.
 * They never trigger a contextual code action and don't count as "binding context".
 */
export const AMBIENT_SOURCES: ReadonlySet<string> = new Set(['tools']);

/** Tools hidden from the `from: tools` list: they need a chat session, or are reserved for built-ins (both enforced by readiness). */
const TOOLS_UNUSABLE_FROM_SKILLS: ReadonlySet<string> = new Set([
    ...CHAT_ONLY_TOOLS,
    ...BUILTIN_ONLY_TOOLS,
]);

const TOOL_DESCRIPTION_MAX = 160;

/** Format installed tools into one `name — description` line each; undefined when none remain. */
export function formatToolList(
    tools: ReadonlyArray<{ name: string; description: string }>
): string | undefined {
    const lines = tools
        .filter(t => !TOOLS_UNUSABLE_FROM_SKILLS.has(t.name))
        .map(t => {
            // One line per tool: collapse whitespace runs first, then cut by
            // code points so a surrogate pair is never split.
            const chars = Array.from(t.description.replace(/\s+/g, ' ').trim());
            const d = chars.length > TOOL_DESCRIPTION_MAX
                ? `${chars.slice(0, TOOL_DESCRIPTION_MAX).join('')}…`
                : chars.join('');
            return `${t.name} — ${d}`;
        });
    return lines.length > 0 ? lines.join('\n') : undefined;
}

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
