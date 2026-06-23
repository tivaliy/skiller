/**
 * Context Resolver
 *
 * captureSnapshot() reads editor/git/diagnostics state once (via injected
 * accessors). resolveInputs() fills `from:`-bound inputs that are still empty,
 * never overwriting an explicitly provided value. Both are pure given their
 * inputs, so they unit-test without the VS Code runtime.
 */

import type { Skill } from '../types';
import type { ContextAccessors, EditorContextSnapshot } from './types';
import { resolveSource } from './sources';
import { createVsCodeContextAccessors } from './accessors';
import { hasValue } from '../utils';

/**
 * A snapshot provider captures one slice of editor state via the boundary. It
 * declares the `from:` sources it `owns` (so capture is gated — a selection-only
 * skill never spawns the git subprocesses) and returns just its part of the
 * snapshot. Several sources can map to one provider: the active-file provider's
 * single getActiveFile() backs `selection` and every `activeFile.*` source.
 *
 * Mirrors the output side's sink registry — `captureSnapshot` is a thin iterate
 * over this table, with no per-source conditionals.
 */
interface SnapshotProvider {
    /** The `from:` sources this provider supplies. Gates whether it runs. */
    owns: readonly string[];
    /** Capture this provider's slice of the snapshot via the injected boundary. */
    capture(accessors: ContextAccessors): Promise<Partial<EditorContextSnapshot>> | Partial<EditorContextSnapshot>;
}

export const SNAPSHOT_PROVIDERS: readonly SnapshotProvider[] = [
    {
        owns: ['selection', 'activeFile', 'activeFile.path', 'activeFile.content', 'activeFile.language'],
        capture(accessors) {
            const active = accessors.getActiveFile();
            if (!active) return {};
            return {
                ...(active.selection ? { selection: active.selection } : {}),
                activeFile: { path: active.path, content: active.content, languageId: active.languageId },
            };
        },
    },
    {
        owns: ['git.staged'],
        async capture(accessors) {
            const diff = await accessors.getGitDiff(true);
            return diff ? { gitStaged: diff } : {};
        },
    },
    {
        owns: ['git.working'],
        async capture(accessors) {
            const diff = await accessors.getGitDiff(false);
            return diff ? { gitWorking: diff } : {};
        },
    },
    {
        owns: ['diagnostics'],
        capture(accessors) {
            const diagnostics = accessors.getDiagnostics();
            return diagnostics ? { diagnostics } : {};
        },
    },
];

/**
 * Read editor state once into an immutable snapshot.
 *
 * When `sources` is given (the set of `from:` expressions a skill actually
 * declares), only the providers whose `owns` intersect it run — so a
 * selection-only skill never pays for the two `git diff` subprocesses, and a
 * git-bound skill runs only the diff it asked for. Omit `sources` to capture
 * everything (e.g. a test, or a caller that doesn't yet know which skill it's for).
 */
export async function captureSnapshot(
    accessors: ContextAccessors,
    sources?: ReadonlySet<string>
): Promise<EditorContextSnapshot> {
    const wanted = SNAPSHOT_PROVIDERS.filter(p => !sources || p.owns.some(s => sources.has(s)));
    const parts = await Promise.all(wanted.map(p => p.capture(accessors)));
    return Object.assign({}, ...parts) as EditorContextSnapshot;
}

/** The set of `from:` sources a skill's inputs bind (empty when none do). */
export function contextSourcesOf(skill: Skill): Set<string> {
    return new Set(skill.inputs.map(i => i.from).filter((f): f is string => !!f));
}

/** Fill `from:`-bound inputs from the snapshot; explicit values always win. */
export function resolveInputs(
    skill: Skill,
    inputs: Record<string, unknown>,
    snapshot: EditorContextSnapshot
): Record<string, unknown> {
    const result = { ...inputs };
    for (const input of skill.inputs) {
        if (!input.from) continue;
        if (hasValue(result[input.name])) continue; // explicit value wins
        const value = resolveSource(input.from, snapshot);
        if (hasValue(value)) {
            result[input.name] = value;
        }
    }
    return result;
}

/**
 * Convenience: capture the current snapshot and resolve `from:` inputs.
 * Fast-path returns `inputs` untouched (no editor read) when no input binds context.
 */
export async function resolveContextInputs(
    skill: Skill,
    inputs: Record<string, unknown>,
    accessors: ContextAccessors = createVsCodeContextAccessors()
): Promise<Record<string, unknown>> {
    const sources = contextSourcesOf(skill);
    if (sources.size === 0) return inputs;
    // Capture only the sources this skill binds, so a selection-only skill doesn't
    // spawn the git diffs it would never read.
    const snapshot = await captureSnapshot(accessors, sources);
    return resolveInputs(skill, inputs, snapshot);
}
