/**
 * Terminal staging sequencing — kept pure (no `vscode` import) so the readiness
 * handling is unit-testable; `accessors.ts` provides the live VS Code wiring.
 *
 * A freshly created terminal is NOT ready in the same tick: VS Code's
 * `Terminal.shellIntegration` "is initially undefined and activates later", and a
 * `sendText` issued before the shell's pty is reading stdin is silently dropped.
 * So we reuse the active terminal when one exists (already ready — the path that
 * works), and otherwise create one and wait until it reports ready before staging.
 *
 * "Stage" means type the text WITHOUT executing it (`sendText(text, false)`): the
 * user reviews the command in place and presses Enter. Pass `shouldExecute` to run it
 * instead — used by the `terminal.run` sink, which is gated by a confirmation step.
 */

/** A terminal we can reveal and type into. */
export interface StageTerminal {
    show(): void;
    sendText(text: string, shouldExecute?: boolean): void;
}

/** The terminal environment — live VS Code in production, fakes in tests. */
export interface TerminalStager {
    /** The active (currently/most-recently focused) terminal, or undefined if none. */
    activeTerminal(): StageTerminal | undefined;
    /** Create a new named terminal; its shell is not ready to receive input yet. */
    createTerminal(name: string): StageTerminal;
    /** Resolve once the terminal can receive input (shell integration, or a timeout fallback). */
    whenReady(terminal: StageTerminal): Promise<void>;
}

/** Name of the terminal skiller spins up when there's no existing one to reuse. */
export const STAGE_TERMINAL_NAME = 'Skiller';

/**
 * Type `content` into a terminal, awaiting readiness when one must be created.
 * Stages it (no execute) by default; pass `shouldExecute` to run it.
 */
export async function stageInTerminal(
    env: TerminalStager,
    content: string,
    shouldExecute = false
): Promise<void> {
    const active = env.activeTerminal();
    if (active) {
        active.show();
        active.sendText(content, shouldExecute);
        return;
    }
    const created = env.createTerminal(STAGE_TERMINAL_NAME);
    created.show();
    await env.whenReady(created);
    created.sendText(content, shouldExecute);
}
