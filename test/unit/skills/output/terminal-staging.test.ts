import { describe, it, expect } from 'vitest';
import { stageInTerminal, STAGE_TERMINAL_NAME } from '../../../../src/skills/output/terminal-staging';
import type { StageTerminal, TerminalStager } from '../../../../src/skills/output/terminal-staging';

class FakeTerminal implements StageTerminal {
  shown = false;
  sent: { text: string; shouldExecute?: boolean }[] = [];
  show(): void { this.shown = true; }
  sendText(text: string, shouldExecute?: boolean): void { this.sent.push({ text, shouldExecute }); }
}

describe('stageInTerminal', () => {
  it('reuses the active terminal and types the text WITHOUT executing it', async () => {
    const active = new FakeTerminal();
    let created = 0;
    const env: TerminalStager = {
      activeTerminal: () => active,
      createTerminal: () => { created++; return new FakeTerminal(); },
      whenReady: async () => {},
    };

    await stageInTerminal(env, "find . -name '*.py'");

    expect(created).toBe(0); // an existing terminal is reused, never a fresh one
    expect(active.shown).toBe(true);
    expect(active.sent).toEqual([{ text: "find . -name '*.py'", shouldExecute: false }]);
  });

  it('creates a terminal but stages the text only AFTER it is ready (readiness race)', async () => {
    const created = new FakeTerminal();
    let resolveReady!: () => void;
    const ready = new Promise<void>(r => { resolveReady = r; });
    const env: TerminalStager = {
      activeTerminal: () => undefined,
      createTerminal: (name) => { expect(name).toBe(STAGE_TERMINAL_NAME); return created; },
      whenReady: () => ready,
    };

    const promise = stageInTerminal(env, 'echo hi');

    // The terminal is created and revealed, but a fresh shell's pty is not ready this
    // tick — sending now would be dropped, so nothing must be sent yet.
    await Promise.resolve();
    expect(created.shown).toBe(true);
    expect(created.sent).toEqual([]);

    // Once it reports ready, the text is typed in (still not executed).
    resolveReady();
    await promise;
    expect(created.sent).toEqual([{ text: 'echo hi', shouldExecute: false }]);
  });

  it('executes the command (shouldExecute=true) when asked, in the active terminal', async () => {
    const active = new FakeTerminal();
    const env: TerminalStager = {
      activeTerminal: () => active,
      createTerminal: () => new FakeTerminal(),
      whenReady: async () => {},
    };

    await stageInTerminal(env, 'npm test', true);

    expect(active.sent).toEqual([{ text: 'npm test', shouldExecute: true }]);
  });

  it('still waits for readiness before executing in a freshly created terminal', async () => {
    const created = new FakeTerminal();
    let resolveReady!: () => void;
    const ready = new Promise<void>(r => { resolveReady = r; });
    const env: TerminalStager = {
      activeTerminal: () => undefined,
      createTerminal: () => created,
      whenReady: () => ready,
    };

    const promise = stageInTerminal(env, 'npm test', true);

    await Promise.resolve();
    expect(created.sent).toEqual([]); // not before ready, even when executing

    resolveReady();
    await promise;
    expect(created.sent).toEqual([{ text: 'npm test', shouldExecute: true }]);
  });
});
