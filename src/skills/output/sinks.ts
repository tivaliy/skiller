/**
 * Output Sinks
 *
 * One registry, keyed by sink kind, that owns everything about a sink: how to
 * parse its `output.to` token, how to deliver to it via the injected boundary,
 * and how to describe where the output went. `parseSink` / `deliverOutput` /
 * `describeSink` are thin lookups over it — mirroring how `CONTEXT_SOURCES`
 * drives the input side. No `vscode` import: the runtime lives behind `OutputDeps`.
 */

import type { OutputSink, OutputDeps, DeliveryTarget } from './types';

type Kind = OutputSink['kind'];

interface SinkSpec {
    /** The exact `output.to` literal, when the sink is selected by an exact token. */
    token?: string;
    /** Recognize + parse an `output.to` string into a sink (undefined if not this sink). */
    parse(to: string): OutputSink | undefined;
    /** Deliver the rendered content via the injected boundary. */
    deliver(deps: OutputDeps, content: string, sink: OutputSink, target?: DeliveryTarget): Promise<void>;
    /** Human phrase for the delivery confirmation, e.g. "opened in a new document". */
    describe(sink: OutputSink): string;
    /** True for editor sinks that write back to the launch document, so a DeliveryTarget must be captured at launch. */
    needsTarget?: boolean;
}

/** Build a parse fn for the common exact-token case. */
const exact = (token: string, kind: Kind) =>
    (to: string): OutputSink | undefined => (to === token ? ({ kind } as OutputSink) : undefined);

/** The `file:` sink carries a path; narrow the union so deliver/describe can read it. */
const filePath = (sink: OutputSink): string => (sink as Extract<OutputSink, { kind: 'file' }>).path;

/**
 * The sink registry. `Record<Kind, …>` is exhaustive by construction: omit a kind
 * and it fails to compile. Adding a sink is one entry here (plus its `OutputDeps`
 * method and `OutputSink` variant).
 */
const SINKS: Record<Kind, SinkSpec> = {
    newDocument: {
        token: 'newDocument',
        parse: exact('newDocument', 'newDocument'),
        deliver: (deps, content) => deps.openNewDocument(content),
        describe: () => 'opened in a new document',
    },
    replaceSelection: {
        token: 'editor.replaceSelection',
        parse: exact('editor.replaceSelection', 'replaceSelection'),
        deliver: (deps, content, _sink, target) => deps.replaceSelection(content, target),
        describe: () => 'applied to the selection',
        needsTarget: true,
    },
    insert: {
        token: 'editor.insert',
        parse: exact('editor.insert', 'insert'),
        deliver: (deps, content, _sink, target) => deps.insertAtCursor(content, target),
        describe: () => 'inserted at the cursor',
        needsTarget: true,
    },
    diff: {
        token: 'diff',
        parse: exact('diff', 'diff'),
        deliver: (deps, content, _sink, target) => deps.showDiff(content, target),
        describe: () => 'opened as a diff — review and apply it from the diff view',
        needsTarget: true,
    },
    terminal: {
        token: 'terminal',
        parse: exact('terminal', 'terminal'),
        deliver: (deps, content) => deps.sendToTerminal(content),
        describe: () => 'typed into your terminal — review it and press Enter to run',
    },
    terminalRun: {
        token: 'terminal.run',
        parse: exact('terminal.run', 'terminalRun'),
        deliver: (deps, content) => deps.runInTerminal(content),
        describe: () => 'sent to your terminal and run',
    },
    file: {
        // Prefix sink (`file:<path>`) — selected by prefix, not an exact token.
        parse: to => {
            if (!to.startsWith('file:')) return undefined;
            const path = to.slice('file:'.length);
            return path ? { kind: 'file', path } : undefined;
        },
        deliver: (deps, content, sink) => deps.writeFile(filePath(sink), content),
        describe: sink => `written to \`${filePath(sink)}\``,
    },
};

/** Parse `output.to` into a structured sink; undefined if absent or unrecognized. */
export function parseSink(to: string | undefined): OutputSink | undefined {
    if (!to) return undefined;
    for (const spec of Object.values(SINKS)) {
        const sink = spec.parse(to);
        if (sink) return sink;
    }
    return undefined;
}

/**
 * Whether an `output.to` value delivers back to the launched editor location, so a
 * DeliveryTarget must be captured at launch. True for the write-back editor sinks
 * (replaceSelection/insert/diff); false for sinks that ignore the target
 * (newDocument/file/terminal). A token that doesn't parse yet — an un-interpolated
 * `{{…}}` or an unknown sink — returns true so the target is captured defensively
 * rather than lost before the real sink is known.
 */
export function outputNeedsTarget(to: string | undefined): boolean {
    if (!to) return false;
    const sink = parseSink(to);
    return sink ? !!SINKS[sink.kind].needsTarget : true;
}

/** Deliver the rendered content to the chosen sink via injected side-effects. */
export function deliverOutput(
    content: string,
    sink: OutputSink,
    deps: OutputDeps,
    target?: DeliveryTarget
): Promise<void> {
    return SINKS[sink.kind].deliver(deps, content, sink, target);
}

/** Human-readable description of where a sink delivered the output. */
export function describeSink(sink: OutputSink): string {
    return SINKS[sink.kind].describe(sink);
}

/**
 * The exact `output.to` tokens (prefix sinks like `file:` excluded). Mirrors
 * `KNOWN_CONTEXT_SOURCES`; the schema derives its accepted-values help from it.
 */
export const KNOWN_SINK_TOKENS: readonly string[] =
    Object.values(SINKS).map(s => s.token).filter((t): t is string => !!t);
