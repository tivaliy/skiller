/** Stage-and-commit: the single writer every scaffold path goes through. Pure over injected ports. */
import { checkNewId, normalizeFiles, yamlIdMismatch } from './ids';
import type { CommitResult, ScaffoldFs, ScaffoldTarget, SkillFileEntries } from './types';

export interface CommitDeps {
    fs: ScaffoldFs;
    /** Validate the staged dir; [] = valid. */
    validate(stagedDir: string): Promise<string[]>;
    takenIds: Iterable<string>;
    allowOverrideOf?: string;
    /** Files come from a shipped source (template/example/built-in), not the AI tool. */
    trusted?: boolean;
}

/** `<root>/<name>`, tolerating a trailing slash on `root`. */
export function childPath(root: string, name: string): string {
    return root.endsWith('/') ? `${root}${name}` : `${root}/${name}`;
}

export async function commitSkill(
    id: string,
    files: SkillFileEntries,
    target: ScaffoldTarget,
    deps: CommitDeps,
): Promise<CommitResult> {
    const { fs } = deps;
    const idError = checkNewId(id, deps.takenIds, { allowOverrideOf: deps.allowOverrideOf });
    if (idError) {
        return { ok: false, errors: [idError] };
    }
    const normalized = normalizeFiles(files, { trusted: deps.trusted });
    if (normalized.errors.length > 0) {
        return { ok: false, errors: normalized.errors };
    }
    const mismatch = yamlIdMismatch(normalized.files, id);
    if (mismatch) {
        return { ok: false, errors: [mismatch] };
    }

    const finalDir = childPath(target.root, id);
    const newStaging = () => childPath(target.root, `.${id}.staging-${Math.random().toString(36).slice(2, 10)}`);
    let staging = newStaging();
    let stagingTouched = false;
    const discardStaging = () =>
        fs.rm(staging).catch((e: unknown) => console.warn('[skiller] failed to remove staging dir', staging, e));
    try {
        if (await fs.exists(finalDir)) {
            return { ok: false, errors: [`Folder "${finalDir}" already exists.`] };
        }
        // Never reuse (or later delete) a directory we did not create.
        while (await fs.exists(staging)) {
            staging = newStaging();
        }
        stagingTouched = true;
        await fs.mkdirp(staging); // also creates target.root
        const madeDirs = new Set([staging]);
        for (const [rel, content] of normalized.files) {
            const dest = childPath(staging, rel);
            const dir = dest.slice(0, dest.lastIndexOf('/'));
            if (!madeDirs.has(dir)) {
                await fs.mkdirp(dir);
                madeDirs.add(dir);
            }
            await fs.writeFile(dest, content);
        }
        const errors = await deps.validate(staging);
        if (errors.length > 0) {
            await discardStaging();
            return { ok: false, errors };
        }
        await fs.rename(staging, finalDir);
        return { ok: true, id, dir: finalDir, tier: target.tier };
    } catch (e) {
        if (stagingTouched) {
            await discardStaging();
        }
        return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
    }
}
