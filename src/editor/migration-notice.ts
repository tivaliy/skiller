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
 * Record that this version is installed. Called when Skiller itself creates a skill, so
 * a new user's first skills are never mistaken for evidence of a pre-0.5 install.
 */
export async function recordInstallVersion(state: Pick<vscode.Memento, 'update'>, version: string): Promise<void> {
    await state.update(RECORDED_VERSION_KEY, version);
}

/**
 * Tell a user upgrading from before 0.5 once that the `@skiller` chat commands are gone.
 *
 * "Upgrading from before 0.5" means: the recorded version is below 0.5.0, or — since 0.4.0
 * recorded nothing — no readable version is recorded and the user has their own skills.
 * With nothing recorded and no own skills the install is undecided: nothing is shown and
 * nothing recorded, so a later window that has the user's skills (activation no longer
 * waits for a skills workspace) can still decide. Otherwise the running version is
 * recorded, and both writes happen before the toast is awaited, since the user may never
 * answer it.
 */
export async function showMigrationNoticeOnce(
    state: Pick<vscode.Memento, 'get' | 'update'>,
    show: (msg: string, ...actions: string[]) => Thenable<string | undefined>,
    run: (cmd: string, ...args: unknown[]) => Thenable<unknown>,
    install: MigrationNoticeInstall
): Promise<void> {
    const recorded = parseMinor(state.get<string>(RECORDED_VERSION_KEY));
    if (!recorded && !install.hasOwnSkills) return; // undecided: a fresh install, or skills elsewhere
    await recordInstallVersion(state, install.version);

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
