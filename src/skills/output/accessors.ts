/**
 * Live VS Code Output Deps
 *
 * The only file in the output module that touches the VS Code runtime. It
 * implements each sink and captures the delivery target; everything else
 * operates on the pure `OutputSink` / `OutputDeps` / `DeliveryTarget` types, so
 * the routing logic stays unit-testable.
 *
 * Editor sinks write to the target captured at launch (document + selection),
 * NOT to whatever editor happens to be focused at completion time — so focus
 * moving into chat during the run can't misplace the result. If the target
 * document changed since launch, a destructive write is refused and the result
 * is opened in a new tab instead (never clobber).
 */

import * as vscode from 'vscode';
import { resolvePath } from '../../tools/utils';
import type { OutputDeps, DeliveryTarget } from './types';
import { stageInTerminal } from './terminal-staging';
import type { TerminalStager } from './terminal-staging';

/** Matches VS Code's documented shell-integration fallback window for new terminals. */
const TERMINAL_READY_TIMEOUT_MS = 3000;

/**
 * Resolve once a terminal can receive input. A freshly created terminal's shell
 * integration activates asynchronously (and never, for shells without it), so we
 * wait for the activation event with a timeout fallback — by which point the pty
 * is ready regardless.
 */
function whenTerminalReady(terminal: vscode.Terminal): Promise<void> {
    if (terminal.shellIntegration) return Promise.resolve();
    return new Promise<void>(resolve => {
        const sub = vscode.window.onDidChangeTerminalShellIntegration(e => {
            if (e.terminal === terminal) done();
        });
        const timer = setTimeout(done, TERMINAL_READY_TIMEOUT_MS);
        function done(): void {
            sub.dispose();
            clearTimeout(timer);
            resolve();
        }
    });
}

/** Live VS Code terminal environment for {@link stageInTerminal}. */
function vsCodeTerminalStager(): TerminalStager {
    return {
        activeTerminal: () => vscode.window.activeTerminal,
        createTerminal: name => vscode.window.createTerminal(name),
        whenReady: terminal => whenTerminalReady(terminal as vscode.Terminal),
    };
}

/** Capture the active editor as a delivery target at launch (uri + version + selection). */
export function captureDeliveryTarget(): DeliveryTarget | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;
    const sel = editor.selection;
    return {
        uri: editor.document.uri.toString(),
        version: editor.document.version,
        selection: {
            start: { line: sel.start.line, character: sel.start.character },
            end: { line: sel.end.line, character: sel.end.character },
        },
    };
}

interface ResolvedTarget {
    doc: vscode.TextDocument;
    range: vscode.Range;
    /** The document was edited since the target was captured at launch. */
    changed: boolean;
}

/** Re-open the launched document and rebuild its range; flag if it changed since launch. */
async function resolveTarget(target?: DeliveryTarget): Promise<ResolvedTarget | undefined> {
    if (!target) return undefined;
    let doc: vscode.TextDocument;
    try {
        doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(target.uri));
    } catch {
        return undefined; // target document is gone
    }
    const range = new vscode.Range(
        target.selection.start.line, target.selection.start.character,
        target.selection.end.line, target.selection.end.character,
    );
    return { doc, range, changed: doc.version !== target.version };
}

export function createVsCodeOutputDeps(): OutputDeps {
    const openNewDocument = async (content: string): Promise<void> => {
        const doc = await vscode.workspace.openTextDocument({ content });
        await vscode.window.showTextDocument(doc);
    };

    // Resolve the launch target for a destructive write, or fall back to a new tab when
    // there's nowhere safe to write: no target was captured, or the document changed since
    // launch (warn, don't clobber). Returns undefined once a fallback has been handled, so
    // callers proceed only when they hold a writable target.
    const resolveWritableTarget = async (
        content: string,
        target: DeliveryTarget | undefined,
        changedNote: string
    ): Promise<ResolvedTarget | undefined> => {
        const loc = await resolveTarget(target);
        if (!loc) { await openNewDocument(content); return undefined; } // no target ⇒ nowhere to write
        if (loc.changed) {
            void vscode.window.showWarningMessage(changedNote);
            await openNewDocument(content);
            return undefined;
        }
        return loc;
    };

    const applyEdit = async (uri: vscode.Uri, build: (edit: vscode.WorkspaceEdit) => void): Promise<void> => {
        const edit = new vscode.WorkspaceEdit();
        build(edit);
        await vscode.workspace.applyEdit(edit);
    };

    return {
        openNewDocument,

        async sendToTerminal(content) {
            // Type the command in WITHOUT executing it — the user reviews it and presses Enter.
            // Reuses the active terminal, or creates one and waits for its shell to be ready
            // (a same-tick sendText to a fresh terminal is dropped). See terminal-staging.
            await stageInTerminal(vsCodeTerminalStager(), content);
        },

        async runInTerminal(content) {
            // Type AND run it. Same terminal acquisition + readiness as staging; only the
            // execute flag differs. The `terminal.run` sink that uses this is gated by a
            // confirmation step, so the user has already reviewed the exact command.
            await stageInTerminal(vsCodeTerminalStager(), content, true);
        },

        async writeFile(path, content) {
            const uri = vscode.Uri.file(resolvePath(path)); // workspace-guarded
            await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
        },

        async replaceSelection(content, target) {
            const loc = await resolveWritableTarget(content, target,
                'Skiller: the document changed since the skill was launched — opened the result in a new tab instead of overwriting your selection.');
            if (!loc) return;
            // Empty range ⇒ inserts at the caret; non-empty ⇒ replaces the selection.
            await applyEdit(loc.doc.uri, edit => edit.replace(loc.doc.uri, loc.range, content));
        },

        async insertAtCursor(content, target) {
            const loc = await resolveWritableTarget(content, target,
                'Skiller: the document changed since the skill was launched — opened the result in a new tab instead of inserting.');
            if (!loc) return;
            await applyEdit(loc.doc.uri, edit => edit.insert(loc.doc.uri, loc.range.start, content));
        },

        async showDiff(content, target) {
            const loc = await resolveTarget(target);
            if (!loc) return openNewDocument(content); // nothing to diff against
            // A selection-scoped proposal splices content at the offsets captured at
            // launch; if the document changed since then those offsets are stale and the
            // splice would garble unrelated code. Fall back to a new tab — consistent
            // with replaceSelection/insert refusing to write a changed document. (The
            // whole-file case, empty range, needs no offsets, so it is unaffected.)
            if (loc.changed && !loc.range.isEmpty) {
                void vscode.window.showWarningMessage('Skiller: the document changed since the skill was launched — opened the proposed result in a new tab instead of diffing against a stale selection.');
                return openNewDocument(content);
            }
            const current = loc.doc;
            const currentText = current.getText();
            // Scope the proposal to the captured selection when there is one; with no
            // selection the proposal is the whole file (a whole-file refactor). This
            // keeps the diff focused and prevents a fragment from clobbering the file.
            const proposedText = loc.range.isEmpty
                ? content
                : currentText.slice(0, current.offsetAt(loc.range.start)) + content + currentText.slice(current.offsetAt(loc.range.end));
            const versionAtProposal = current.version;

            const proposed = await vscode.workspace.openTextDocument({ content: proposedText, language: current.languageId });
            await vscode.commands.executeCommand(
                'vscode.diff', current.uri, proposed.uri,
                `Skiller: proposed changes — ${vscode.workspace.asRelativePath(current.uri)}`,
            );
            const choice = await vscode.window.showInformationMessage(
                `Apply Skiller's changes to ${vscode.workspace.asRelativePath(current.uri)}?`,
                { modal: true }, 'Apply',
            );
            if (choice !== 'Apply') return;

            // Guard against edits made while the diff/modal was open (TOCTOU): if the
            // document moved on from the version we computed the proposal against,
            // refuse to apply rather than discard those edits.
            const fresh = await vscode.workspace.openTextDocument(current.uri);
            if (fresh.version !== versionAtProposal) {
                void vscode.window.showWarningMessage('Skiller: the file changed while the diff was open — not applied. Re-run to review against the latest.');
                return;
            }
            const fullRange = new vscode.Range(fresh.positionAt(0), fresh.positionAt(fresh.getText().length));
            await applyEdit(fresh.uri, edit => edit.replace(fresh.uri, fullRange, proposedText));
        },
    };
}
