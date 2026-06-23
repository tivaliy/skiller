/**
 * Editor Context Types
 *
 * An immutable snapshot of editor/git state, captured once at launch, plus the
 * accessor boundary that produces it. Isolating VS Code access behind
 * ContextAccessors keeps source resolution unit-testable without the runtime.
 */

/** Immutable snapshot of editor state captured at launch (trigger time for A1). */
export interface EditorContextSnapshot {
    /** Selected text in the active editor (undefined if no selection). */
    selection?: string;
    /** Active document path / contents / languageId (undefined if no editor). */
    activeFile?: { path: string; content: string; languageId: string };
    /** Staged changes as unified diff text. */
    gitStaged?: string;
    /** Working-tree changes as unified diff text. */
    gitWorking?: string;
    /** Diagnostics for the active file, formatted as `line: message` lines. */
    diagnostics?: string;
}

/** The VS Code boundary. Implemented live in accessors.ts; faked in tests. */
export interface ContextAccessors {
    /** Active editor file info + current selection text, or undefined. */
    getActiveFile(): { path: string; content: string; languageId: string; selection?: string } | undefined;
    /** Unified diff for staged (true) or working-tree (false) changes, or undefined. */
    getGitDiff(staged: boolean): Promise<string | undefined>;
    /** Diagnostics for the active file as text, or undefined. */
    getDiagnostics(): string | undefined;
}

/** A pure extractor: snapshot → string value (or undefined). */
export type ContextSource = (snapshot: EditorContextSnapshot) => string | undefined;
