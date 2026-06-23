/**
 * Output Sink Types
 *
 * Where a completed skill's rendered `output.summary` is delivered. The sink
 * logic is pure given an injected `OutputDeps` (the VS Code boundary), so it
 * unit-tests without the runtime.
 */

/** Parsed output sink: the destination for a completed skill's rendered summary. */
export type OutputSink =
    | { kind: 'newDocument' }
    | { kind: 'file'; path: string }
    | { kind: 'replaceSelection' }
    | { kind: 'insert' }
    | { kind: 'diff' }
    | { kind: 'terminal' }
    | { kind: 'terminalRun' };

/** A 0-based position in a document, as plain data (no vscode types). */
export interface TargetPosition { line: number; character: number }

/**
 * Where an editor-bound sink writes: the document and selection captured at the
 * moment the skill was launched. Plain data so it crosses the pure/boundary line
 * and survives the multi-turn hand-off via the launch store; the sink resolves it
 * back to a live document at delivery time and aborts if that document changed.
 */
export interface DeliveryTarget {
    /** The launched document's URI (uri.toString()). */
    uri: string;
    /** The document version at launch — lets a sink detect edits before writing. */
    version: number;
    /** The selection at launch (start === end means a caret, i.e. no selection). */
    selection: { start: TargetPosition; end: TargetPosition };
}

/** Injected side-effects so deliverOutput is testable without the VS Code runtime. */
export interface OutputDeps {
    /** Open the content as a new untitled document. */
    openNewDocument(content: string): Promise<void>;
    /** Write the content to a workspace-relative or absolute path (workspace-guarded). */
    writeFile(path: string, content: string): Promise<void>;
    /** Replace the launch target's selection with the content. */
    replaceSelection(content: string, target?: DeliveryTarget): Promise<void>;
    /** Insert the content at the launch target's caret. */
    insertAtCursor(content: string, target?: DeliveryTarget): Promise<void>;
    /** Show the content as a reviewable diff scoped to the launch target. */
    showDiff(content: string, target?: DeliveryTarget): Promise<void>;
    /** Type the content into the integrated terminal without executing it (the user presses Enter). */
    sendToTerminal(content: string): Promise<void>;
    /** Type the content into the integrated terminal and run it (gated by a confirmation step). */
    runInTerminal(content: string): Promise<void>;
}

/** Outcome of routing a completed skill's summary to its output sink. */
export type DeliveryOutcome =
    | { kind: 'none' }                         // chat-only, or nothing to deliver
    | { kind: 'delivered'; sink: OutputSink }  // routed to the sink successfully
    | { kind: 'unknownSink'; to: string }      // output.to did not parse to a known sink
    | { kind: 'failed'; message: string };     // the sink threw while delivering
