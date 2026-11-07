/** Pure scaffold types (no vscode, no fs). */

/** posix relative path → file content */
export type SkillFiles = ReadonlyMap<string, string>;
/** Files as written by a caller, before normalization: may repeat a path (reported as a duplicate). */
export type SkillFileEntries = Iterable<readonly [string, string]>;
export type Tier = 'workspace' | 'user';
/** `root` is the tier's skills directory. */
export interface ScaffoldTarget {
    root: string;
    tier: Tier;
}
/** On success, `tier` is the tier actually written to (callers must not re-resolve it). */
export type CommitResult =
    | { ok: true; id: string; dir: string; tier: ScaffoldTarget['tier'] }
    | { ok: false; errors: string[] };

/** A skill that was just written: what the post-create steps need. */
export interface CreatedSkill {
    id: string;
    dir: string;
    /** The tier the skill was written to (from the commit result). */
    tier: ScaffoldTarget['tier'];
    /** A built-in copy that kept its id, so it now overrides the built-in. */
    overridesBuiltin?: boolean;
}

export interface ScaffoldFs {
    exists(p: string): Promise<boolean>;
    /** Creates missing parent directories too. */
    mkdirp(p: string): Promise<void>;
    writeFile(p: string, content: string): Promise<void>;
    /** Recursive, posix keys, skips dot-entries. */
    readTree(dir: string): Promise<SkillFiles>;
    rename(from: string, to: string): Promise<void>;
    /** Recursive, no error if missing. */
    rm(p: string): Promise<void>;
}
