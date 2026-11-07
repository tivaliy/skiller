/**
 * Scaffold source registry. Pure: directory listing is injected via `SourceEnv`.
 * Each source kind is one provider in `SOURCE_PROVIDERS`.
 */
import * as path from 'node:path';
import type { Skill } from '../../skills/types';
import { isCopyableBuiltin } from '../../skills/reserved-tools';
import { TEMPLATES } from './templates';

export type ScaffoldKind = 'template' | 'example' | 'builtin';

export interface ScaffoldSource {
    kind: ScaffoldKind;
    id: string;
    label: string;
    detail?: string;
    dir: string;
}

export interface SourceEnv {
    extensionPath: string;
    builtins: ReadonlyArray<{ id: string; name: string; description: string; dir: string }>;
    /** Child directory names; [] if the directory is missing. */
    listDirs(dir: string): Promise<string[]>;
}

export interface SourceProvider {
    kind: ScaffoldKind;
    list(env: SourceEnv): Promise<ScaffoldSource[]>;
}

export const SOURCE_PROVIDERS: readonly SourceProvider[] = [
    {
        kind: 'template',
        async list(env) {
            return TEMPLATES.map((t) => ({
                kind: 'template' as const,
                id: t.id,
                label: t.label,
                detail: t.detail,
                dir: path.join(env.extensionPath, 'templates', t.id),
            }));
        },
    },
    {
        kind: 'example',
        async list(env) {
            const root = path.join(env.extensionPath, '.skiller', 'skills');
            const names = await env.listDirs(root);
            return names.map((name) => ({
                kind: 'example' as const,
                id: name,
                label: name,
                dir: path.join(root, name),
            }));
        },
    },
    {
        kind: 'builtin',
        async list(env) {
            return env.builtins.map((b) => ({
                kind: 'builtin' as const,
                id: b.id,
                label: b.name,
                detail: b.description,
                dir: b.dir,
            }));
        },
    },
];

/** Sources of the given kinds (all kinds when omitted); only those providers are queried. */
export async function listSources(env: SourceEnv, kinds?: readonly ScaffoldKind[]): Promise<ScaffoldSource[]> {
    const providers = kinds ? SOURCE_PROVIDERS.filter((p) => kinds.includes(p.kind)) : SOURCE_PROVIDERS;
    return (await Promise.all(providers.map((p) => p.list(env)))).flat();
}

/** Built-in skills that can be offered for copying: not those using built-in-only tools (a copy could not run). */
export function copyableBuiltins(skills: readonly Skill[]): SourceEnv['builtins'] {
    return skills
        .filter(isCopyableBuiltin)
        .map((s) => ({ id: s.id, name: s.name, description: s.description, dir: s.source.path }));
}
