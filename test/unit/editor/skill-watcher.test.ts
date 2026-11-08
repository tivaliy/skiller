/**
 * Skill folders are watched: creating, saving, or deleting a skill's files reloads
 * the skill list, so Run never uses a stale skill.yaml.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { watchSkillFolders } from '../../../src/editor/skill-watcher';
import type { SkillWatcherDeps } from '../../../src/editor/skill-watcher';

type Listener = () => void;

function fakeWatcher() {
    const listeners: Listener[] = [];
    const on = (listener: Listener) => { listeners.push(listener); return { dispose: () => {} }; };
    return {
        onDidCreate: vi.fn(on),
        onDidChange: vi.fn(on),
        onDidDelete: vi.fn(on),
        dispose: vi.fn(),
        fire: () => { for (const listener of listeners) listener(); },
    };
}

describe('watchSkillFolders', () => {
    let watchers: Array<ReturnType<typeof fakeWatcher>>;
    let refresh: ReturnType<typeof vi.fn>;
    let deps: SkillWatcherDeps;

    beforeEach(() => {
        vi.useFakeTimers();
        watchers = [];
        refresh = vi.fn(async () => {});
        deps = {
            targets: [
                { base: '/ws', pattern: '.skiller/skills/**' },
                { base: '/home/.vscode/skiller/skills', pattern: '**' },
            ],
            createWatcher: vi.fn(() => {
                const watcher = fakeWatcher();
                watchers.push(watcher);
                return watcher as unknown as ReturnType<SkillWatcherDeps['createWatcher']>;
            }),
            refresh,
            debounceMs: 300,
        };
    });
    afterEach(() => { vi.useRealTimers(); });

    it('watches each skill folder for created, changed, and deleted files', () => {
        watchSkillFolders(deps);
        expect(deps.createWatcher).toHaveBeenCalledWith('/ws', '.skiller/skills/**');
        expect(deps.createWatcher).toHaveBeenCalledWith('/home/.vscode/skiller/skills', '**');
        for (const watcher of watchers) {
            expect(watcher.onDidCreate).toHaveBeenCalled();
            expect(watcher.onDidChange).toHaveBeenCalled();
            expect(watcher.onDidDelete).toHaveBeenCalled();
        }
    });

    it('reloads once after a burst of changes settles', async () => {
        watchSkillFolders(deps);
        watchers[0].fire();
        watchers[1].fire();
        await vi.advanceTimersByTimeAsync(200);
        watchers[0].fire();
        expect(refresh).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(300);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('never runs two reloads at once: a change during a reload reloads again afterwards', async () => {
        let finish!: () => void;
        refresh.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        watchSkillFolders(deps);

        watchers[0].fire();
        await vi.advanceTimersByTimeAsync(300);
        expect(refresh).toHaveBeenCalledTimes(1);

        watchers[0].fire(); // saved again while the first reload runs
        await vi.advanceTimersByTimeAsync(300);
        expect(refresh).toHaveBeenCalledTimes(1);

        finish();
        await vi.advanceTimersByTimeAsync(300);
        expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('keeps watching after a reload fails', async () => {
        const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
        refresh.mockRejectedValueOnce(new Error('disk gone'));
        watchSkillFolders(deps);

        watchers[0].fire();
        await vi.advanceTimersByTimeAsync(300);
        watchers[0].fire();
        await vi.advanceTimersByTimeAsync(300);

        expect(refresh).toHaveBeenCalledTimes(2);
        expect(logError).toHaveBeenCalled();
        logError.mockRestore();
    });

    it('skips folders it cannot watch, and stops (no pending reload) once disposed', async () => {
        deps.targets = [{ base: '/ws', pattern: '.skiller/skills/**' }, undefined];
        const watching = watchSkillFolders(deps);
        expect(deps.createWatcher).toHaveBeenCalledTimes(1);

        watchers[0].fire();
        watching.dispose();
        await vi.advanceTimersByTimeAsync(1000);

        expect(refresh).not.toHaveBeenCalled();
        expect(watchers[0].dispose).toHaveBeenCalled();
    });
});
