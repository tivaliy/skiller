import { describe, expect, it, vi } from 'vitest';
import { Uri } from 'vscode';
import {
    MIGRATION_DOCS_URL,
    MIGRATION_NOTICE_KEY,
    RECORDED_VERSION_KEY,
    showMigrationNoticeOnce,
    type MigrationNoticeInstall,
} from '../../../src/editor/migration-notice';

/** An in-memory stand-in for `ExtensionContext.globalState`. */
function memento(initial: Record<string, unknown> = {}) {
    const values = new Map<string, unknown>(Object.entries(initial));
    return {
        values,
        keys: () => [...values.keys()],
        get: <T>(key: string, fallback?: T): T | undefined =>
            (values.has(key) ? values.get(key) as T : fallback),
        update: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }),
    };
}

function harness(opts: {
    state?: Record<string, unknown>;
    install?: Partial<MigrationNoticeInstall>;
    pick?: string;
} = {}) {
    const state = memento(opts.state);
    const show = vi.fn(async (_msg: string, ..._actions: string[]) => opts.pick);
    const run = vi.fn(async (_cmd: string, ..._args: unknown[]) => undefined);
    const install: MigrationNoticeInstall = { version: '0.5.0', hasOwnSkills: false, ...opts.install };
    const notice = () => showMigrationNoticeOnce(state, show, run, install);
    return { state, show, run, notice };
}

describe('showMigrationNoticeOnce', () => {
    it('shows once after upgrading from 0.4.x', async () => {
        const h = harness({ state: { [RECORDED_VERSION_KEY]: '0.4.2' } });

        await h.notice();
        await h.notice();

        expect(h.show).toHaveBeenCalledTimes(1);
        expect(h.show).toHaveBeenCalledWith(
            '@skiller chat commands moved: run skills with Skiller: Run Skill… or ask Copilot — it can now run your Skiller workflows.',
            'Run a Skill', 'Learn more');
        expect(h.state.values.get(MIGRATION_NOTICE_KEY)).toBe(true);
    });

    it('shows once to a 0.4.0 user, who has no recorded version but has their own skills', async () => {
        // 0.4.0 stored nothing in globalState, so a workspace or user skill is the evidence of prior use.
        const h = harness({ install: { hasOwnSkills: true } });

        await h.notice();
        await h.notice();

        expect(h.show).toHaveBeenCalledTimes(1);
    });

    it('never shows on a fresh install', async () => {
        const h = harness({ install: { hasOwnSkills: false } });

        await h.notice();

        expect(h.show).not.toHaveBeenCalled();
    });

    it('never shows when the recorded version is already 0.5 or later', async () => {
        const h = harness({ state: { [RECORDED_VERSION_KEY]: '0.5.0' }, install: { version: '0.5.1', hasOwnSkills: true } });

        await h.notice();

        expect(h.show).not.toHaveBeenCalled();
    });

    it('records the running version, so the next activation can tell an upgrade from a fresh install', async () => {
        const h = harness({ install: { version: '0.5.3' } });

        await h.notice();

        expect(h.state.values.get(RECORDED_VERSION_KEY)).toBe('0.5.3');
    });

    it('marks the notice as shown before the user answers, so a dismissed or ignored toast never returns', async () => {
        const h = harness({ state: { [RECORDED_VERSION_KEY]: '0.4.0' } });
        h.show.mockReturnValue(new Promise<undefined>(() => { /* never answered */ }));

        void h.notice();
        await vi.waitFor(() => expect(h.show).toHaveBeenCalled());

        expect(h.state.values.get(MIGRATION_NOTICE_KEY)).toBe(true);
        expect(h.state.values.get(RECORDED_VERSION_KEY)).toBe('0.5.0');
    });

    it('treats an unreadable recorded version as unknown and falls back to the evidence of prior use', async () => {
        const fresh = harness({ state: { [RECORDED_VERSION_KEY]: 'garbage' }, install: { hasOwnSkills: false } });
        const used = harness({ state: { [RECORDED_VERSION_KEY]: 'garbage' }, install: { hasOwnSkills: true } });

        await fresh.notice();
        await used.notice();

        expect(fresh.show).not.toHaveBeenCalled();
        expect(used.show).toHaveBeenCalledTimes(1);
    });

    it('Run a Skill runs skiller.runSkill', async () => {
        const h = harness({ state: { [RECORDED_VERSION_KEY]: '0.4.0' }, pick: 'Run a Skill' });

        await h.notice();

        expect(h.run).toHaveBeenCalledWith('skiller.runSkill');
    });

    it('Learn more opens the running-skills docs', async () => {
        const h = harness({ state: { [RECORDED_VERSION_KEY]: '0.4.0' }, pick: 'Learn more' });

        await h.notice();

        expect(h.run).toHaveBeenCalledTimes(1);
        expect(h.run).toHaveBeenCalledWith('vscode.open', Uri.parse(MIGRATION_DOCS_URL));
    });

    it('does nothing when the toast is dismissed', async () => {
        const h = harness({ state: { [RECORDED_VERSION_KEY]: '0.4.0' }, pick: undefined });

        await h.notice();

        expect(h.run).not.toHaveBeenCalled();
    });
});
