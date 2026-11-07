/** Pure orchestration of the New Skill / Copy Skill flows over a UI port. */
import { checkNewId, rewriteIdentity, suggestFreeId, titleFromId } from './ids';
import { childPath, commitSkill } from './commit';
import { listSources, type ScaffoldKind, type ScaffoldSource, type SourceEnv } from './sources/registry';
import { renderTemplate } from './sources/templates';
import type { CommitResult, CreatedSkill, ScaffoldFs, ScaffoldTarget, SkillFiles } from './types';
import { NEW_SKILL_KINDS, type NewSkillKind } from './kinds';


export interface ScaffoldUi {
    pickKind(): Promise<NewSkillKind | undefined>;
    pickSource(sources: ScaffoldSource[]): Promise<ScaffoldSource | undefined>;
    askId(suggested: string, validate: (id: string) => string | undefined): Promise<string | undefined>;
    /** Asks for the idea, then runs the skill-creator with it. */
    openDescribe(): Promise<void>;
    showErrors(errors: string[]): void;
}

export interface FlowDeps {
    ui: ScaffoldUi;
    env: SourceEnv;
    fs: ScaffoldFs;
    target: ScaffoldTarget;
    takenIds(): string[];
    validate(dir: string): Promise<string[]>;
    finish(result: CreatedSkill): Promise<void>;
}

const KNOWN_KINDS: ReadonlySet<string> = new Set(NEW_SKILL_KINDS.map((k) => k.kind));

/** Per flow kind: the source kinds it offers, and the message for a `sourceId` it does not offer. */
const KIND_SOURCES: Record<Exclude<NewSkillKind, 'describe'>, { sources: readonly ScaffoldKind[]; notOffered(sourceId: string): string }> = {
    template: {
        sources: ['template'],
        notOffered: (sourceId) => `Unknown skill template "${sourceId}".`,
    },
    copy: {
        sources: ['example', 'builtin'],
        notOffered: (sourceId) =>
            `Skill "${sourceId}" is not available to copy (it may already be overridden in your workspace or user skills).`,
    },
};

/** How a source kind turns into a target id + files. One entry per kind. */
interface IdPolicy {
    /** When the user is asked for an id: always, or only if the source id is taken (registered or an existing folder). */
    ask: 'always' | 'ifTaken';
    /** The id pre-filled in the prompt. */
    suggest(sourceId: string, taken: readonly string[]): string;
    /** Adapt the source files to the chosen identity. */
    adapt(files: SkillFiles, identity: { id: string; name: string }, sourceId: string): SkillFiles;
    /** Keeping the source id may override its existing registration (built-ins), so that alone doesn't count as taken. */
    overrides: boolean;
}

/** Copies keep the source id when it is free, else take a suggested `-copy` id. */
const COPY: Omit<IdPolicy, 'overrides'> = {
    ask: 'ifTaken',
    suggest: (sourceId, taken) => suggestFreeId(sourceId, taken),
    adapt: (files, identity, sourceId) => (identity.id === sourceId ? files : rewriteIdentity(files, identity)),
};

const ID_POLICY: Record<ScaffoldKind, IdPolicy> = {
    template: {
        ask: 'always',
        suggest: () => 'my-skill',
        // Re-write id/name through rewriteIdentity so they are YAML-quoted when needed
        // (e.g. id `true-` → name `True`, which would otherwise load as a boolean).
        adapt: (files, identity) => rewriteIdentity(renderTemplate(files, identity), identity),
        overrides: false,
    },
    example: { ...COPY, overrides: false },
    builtin: { ...COPY, overrides: true },
};

/**
 * Ask for an id that is neither registered nor an existing folder under the target root.
 * The live validator only knows registered ids (it is synchronous), so a folder clash is
 * caught on submit: the id is remembered and the prompt re-opens, now rejecting it inline.
 */
async function askFreeId(deps: FlowDeps, suggested: string): Promise<string | undefined> {
    const onDisk = new Set<string>();
    const validate = (v: string): string | undefined =>
        checkNewId(v, deps.takenIds()) ??
        (onDisk.has(v.toLowerCase()) ? `Folder "${childPath(deps.target.root, v)}" already exists.` : undefined);
    let value = suggested;
    for (;;) {
        const asked = await deps.ui.askId(value, validate);
        if (!asked) {
            return undefined;
        }
        if (!(await deps.fs.exists(childPath(deps.target.root, asked)))) {
            return asked;
        }
        onDisk.add(asked.toLowerCase());
        value = asked;
    }
}

/**
 * @param sourceId  skip the source picker and use this source id
 * @param sourceKind  with `sourceId`: which kind it names (e.g. Copy to Workspace… in Show Skills names a built-in),
 *                    so an example and a built-in sharing an id can't be confused
 */
export async function runNewSkillFlow(
    deps: FlowDeps,
    kind?: NewSkillKind,
    sourceId?: string,
    sourceKind?: ScaffoldKind,
): Promise<CommitResult | undefined> {
    const { ui, env, fs } = deps;
    const chosen = kind && KNOWN_KINDS.has(kind) ? kind : await ui.pickKind();
    if (!chosen) {
        return undefined;
    }
    if (chosen === 'describe') {
        await ui.openDescribe();
        return undefined;
    }

    const offer = KIND_SOURCES[chosen];
    const candidates = await listSources(env, offer.sources);
    const source = sourceId
        ? candidates.find((s) => s.id === sourceId && (!sourceKind || s.kind === sourceKind))
        : await ui.pickSource(candidates);
    if (!source) {
        if (sourceId) {
            ui.showErrors([offer.notOffered(sourceId)]);
        }
        return undefined;
    }

    const policy = ID_POLICY[source.kind];

    let files: SkillFiles;
    try {
        files = await fs.readTree(source.dir);
    } catch (e) {
        const errors = [e instanceof Error ? e.message : String(e)];
        ui.showErrors(errors);
        return { ok: false, errors };
    }
    const taken = deps.takenIds();
    let id = source.id;
    const overrideOf = policy.overrides ? source.id : undefined;
    const sourceIdTaken = async () =>
        checkNewId(source.id, taken, { allowOverrideOf: overrideOf }) !== undefined ||
        (await fs.exists(childPath(deps.target.root, source.id)));
    if (policy.ask === 'always' || (await sourceIdTaken())) {
        const asked = await askFreeId(deps, policy.suggest(source.id, taken));
        if (!asked) {
            return undefined;
        }
        id = asked;
    }
    const out = policy.adapt(files, { id, name: titleFromId(id) }, source.id);
    const allowOverrideOf = id === source.id ? overrideOf : undefined;

    const result = await commitSkill(id, out, deps.target, {
        fs,
        validate: deps.validate,
        takenIds: deps.takenIds(),
        allowOverrideOf,
        trusted: true,
    });
    if (result.ok) {
        await deps.finish({ id: result.id, dir: result.dir, tier: result.tier, overridesBuiltin: allowOverrideOf !== undefined });
    } else {
        ui.showErrors(result.errors);
    }
    return result;
}
