import * as vscode from 'vscode';

/** Global-state key: set once the 0.5 migration notice has been shown. */
export const MIGRATION_NOTICE_KEY = 'skiller.migrationNotice.v0_5';
/** Global-state key: the extension version that last activated, recorded on every activation. */
export const RECORDED_VERSION_KEY = 'skiller.extensionVersion';
/** Where "Learn more" leads: the running-skills page, which maps the old chat commands to the new ones. */
export const MIGRATION_DOCS_URL = 'https://tivaliy.github.io/skiller/guides/running-skills/';

const MESSAGE =
    '@skiller chat commands moved: run skills with Skiller: Run Skill… or ask Copilot — it can now run your Skiller workflows.';
const RUN_A_SKILL = 'Run a Skill';
const LEARN_MORE = 'Learn more';

/** What the notice needs to know about this installation. */
export interface MigrationNoticeInstall {
    /** The running extension version. */
    version: string;
    /** Whether a workspace or user skill exists — evidence of use before 0.5. */
    hasOwnSkills: boolean;
}

/**
 * Tell a user upgrading from before 0.5 once that the `@skiller` chat commands are gone.
 *
 * "Upgrading from before 0.5" means: the recorded version is below 0.5.0, or — since 0.4.0
 * recorded nothing — no readable version is recorded and the user has their own skills.
 * A fresh install (nothing recorded, no own skills) sees nothing. The running version is
 * recorded on every call, and both writes happen before the toast is awaited, since the
 * user may never answer it.
 */
export async function showMigrationNoticeOnce(
    state: Pick<vscode.Memento, 'get' | 'update'>,
    show: (msg: string, ...actions: string[]) => Thenable<string | undefined>,
    run: (cmd: string, ...args: unknown[]) => Thenable<unknown>,
    install: MigrationNoticeInstall
): Promise<void> {
    const recorded = parseMinor(state.get<string>(RECORDED_VERSION_KEY));
    await state.update(RECORDED_VERSION_KEY, install.version);

    if (state.get<boolean>(MIGRATION_NOTICE_KEY)) return;
    const upgradedFromBefore05 = recorded
        ? recorded.major === 0 && recorded.minor < 5
        : install.hasOwnSkills;
    if (!upgradedFromBefore05) return;

    await state.update(MIGRATION_NOTICE_KEY, true);
    const picked = await show(MESSAGE, RUN_A_SKILL, LEARN_MORE);
    if (picked === RUN_A_SKILL) {
        await run('skiller.runSkill');
    } else if (picked === LEARN_MORE) {
        await run('vscode.open', vscode.Uri.parse(MIGRATION_DOCS_URL));
    }
}

/** `major.minor` of a version string, or undefined when it doesn't look like one. */
function parseMinor(version: string | undefined): { major: number; minor: number } | undefined {
    const match = /^(\d+)\.(\d+)/.exec(version ?? '');
    return match ? { major: Number(match[1]), minor: Number(match[2]) } : undefined;
}
