/**
 * Watch the skill folders and reload the skill list when a skill's files are
 * created, saved, or deleted — so Run never uses a stale skill.yaml, and a skill
 * added outside VS Code (a git pull, a copy) shows up without Reload Skills.
 *
 * Only the registry is refreshed. Open graphs already follow edits live, and
 * re-rendering them from the registry would close a graph whose skill.yaml is
 * mid-edit with a typo. Run highlights are left alone too.
 */

import type * as vscode from 'vscode';

/** A folder to watch: a base path and a glob relative to it. */
export interface WatchTarget {
    base: string;
    pattern: string;
}

/** The part of a FileSystemWatcher the watcher uses. */
type Watcher = Pick<vscode.FileSystemWatcher, 'onDidCreate' | 'onDidChange' | 'onDidDelete' | 'dispose'>;

export interface SkillWatcherDeps {
    /** Folders to watch; undefined entries (no workspace open) are skipped. */
    targets: ReadonlyArray<WatchTarget | undefined>;
    createWatcher(base: string, pattern: string): Watcher;
    /** Reload the skill list. */
    refresh(): Promise<void>;
    /** Quiet period before reloading, so a git checkout reloads once. */
    debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 300;

export function watchSkillFolders(deps: SkillWatcherDeps): vscode.Disposable {
    const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refreshing = false;
    let again = false;
    let disposed = false;

    const schedule = (): void => {
        if (disposed) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = undefined; void reload(); }, debounceMs);
    };

    const reload = async (): Promise<void> => {
        if (disposed) return;
        if (refreshing) {
            again = true; // reload once more when this one finishes
            return;
        }
        refreshing = true;
        try {
            await deps.refresh();
        } catch (error) {
            console.error('Skiller: reloading skills after a file change failed', error);
        } finally {
            refreshing = false;
            if (again) {
                again = false;
                schedule();
            }
        }
    };

    const disposables: Array<{ dispose(): unknown }> = [];
    for (const target of deps.targets) {
        if (!target) continue;
        const watcher = deps.createWatcher(target.base, target.pattern);
        disposables.push(
            watcher,
            watcher.onDidCreate(schedule),
            watcher.onDidChange(schedule),
            watcher.onDidDelete(schedule),
        );
    }

    return {
        dispose: () => {
            disposed = true;
            if (timer) clearTimeout(timer);
            for (const disposable of disposables) disposable.dispose();
        },
    };
}
