/**
 * The Skiller status bar item: a permanent way in now that `@skiller` is gone.
 * Idle it opens Show Skills; during a run it names the skill and brings its graph forward.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import * as vscode from 'vscode';
import { createSkillerStatusBar } from '../../../src/editor/status-bar';
import type { Skill } from '../../../src/skills/types';

const createStatusBarItem = vscode.window.createStatusBarItem as unknown as Mock;

function fakeItem() {
    return { text: '', tooltip: undefined as unknown, command: undefined as unknown, name: undefined as unknown, show: vi.fn(), dispose: vi.fn() };
}

function fakeRuns() {
    const listeners = new Set<() => void>();
    return {
        active: undefined as { skill: Skill } | undefined,
        onDidChangeActive: vi.fn((listener: () => void) => {
            listeners.add(listener);
            return { dispose: () => { listeners.delete(listener); } };
        }),
        set(skill: Skill | undefined) {
            this.active = skill ? { skill } : undefined;
            for (const listener of listeners) listener();
        },
        listenerCount: () => listeners.size,
    };
}

const greeter = { id: 'greeter', name: 'Greeter' } as Skill;

describe('createSkillerStatusBar', () => {
    let item: ReturnType<typeof fakeItem>;
    let runs: ReturnType<typeof fakeRuns>;

    beforeEach(() => {
        item = fakeItem();
        createStatusBarItem.mockReset();
        createStatusBarItem.mockReturnValue(item);
        runs = fakeRuns();
    });

    it('shows a named, always-visible item that opens Show Skills', () => {
        createSkillerStatusBar(runs);

        // An id and a name let people hide it from the status bar's own context menu.
        expect(createStatusBarItem).toHaveBeenCalledWith('skiller.status', vscode.StatusBarAlignment.Right, expect.any(Number));
        expect(item.name).toBe('Skiller');
        expect(item.text).toBe('$(workflow) Skiller');
        expect(item.tooltip).toBe('Skiller: show your skills');
        expect(item.command).toBe('skiller.showSkills');
        expect(item.show).toHaveBeenCalled();
    });

    it('names the running skill, brings its graph forward on click, and goes back when the run ends', () => {
        createSkillerStatusBar(runs);

        runs.set(greeter);
        expect(item.text).toBe('$(loading~spin) Greeter');
        expect(item.tooltip).toBe('Skiller is running Greeter. Click to show its graph.');
        expect(item.command).toBe('skiller.showRun');

        runs.set(undefined);
        expect(item.text).toBe('$(workflow) Skiller');
        expect(item.command).toBe('skiller.showSkills');
    });

    it('stops listening and removes the item when disposed', () => {
        const bar = createSkillerStatusBar(runs);
        bar.dispose();
        expect(runs.listenerCount()).toBe(0);
        expect(item.dispose).toHaveBeenCalled();
    });
});

describe('status bar activation', () => {
    it('activates after startup, so the item is there before any skill or command exists', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
        expect(pkg.activationEvents).toContain('onStartupFinished');
    });
});
