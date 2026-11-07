import * as yaml from 'js-yaml';
import { stripCodeFence } from '../skills/utils';
import type { SkillFileEntries, SkillFiles } from './types';

export const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

const ALLOWED_EXT = /\.(yaml|yml|md)$/i;

/** Plain scalars YAML would read as a boolean/null, so `id: true` would not be the string "true". */
const YAML_RESERVED: ReadonlySet<string> = new Set(['true', 'false', 'null']);

export function checkNewId(
    id: string,
    takenIds: Iterable<string>,
    opts: { allowOverrideOf?: string } = {},
): string | undefined {
    if (!ID_PATTERN.test(id)) {
        return `Skill id "${id}" is invalid: it must start with a letter and contain only letters, digits, "-" or "_".`;
    }
    const lower = id.toLowerCase();
    if (YAML_RESERVED.has(lower)) {
        return `"${id}" is a reserved word in YAML; pick another id.`;
    }
    const exempt = opts.allowOverrideOf?.toLowerCase();
    for (const t of takenIds) {
        const tl = t.toLowerCase();
        if (tl === lower && tl !== exempt) {
            return `A skill with id "${t}" already exists.`;
        }
    }
    return undefined;
}

export function suggestFreeId(id: string, takenIds: Iterable<string>): string {
    const taken = new Set([...takenIds].map((t) => t.toLowerCase()));
    let candidate = `${id}-copy`;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
        candidate = `${id}-copy-${n}`;
    }
    return candidate;
}

/** Strip one code fence that wraps the whole value; then end with a single newline. */
function stripWrappingFence(value: string): string {
    const inner = stripCodeFence(value);
    return inner === value ? value : inner.replace(/\s+$/, '') + '\n';
}

/** Characters Windows does not allow in file names (':' would also open an alternate data stream). */
const WINDOWS_INVALID_CHARS = /[<>:"|?*\x00-\x1f]/;
/** Windows device names, reserved with any extension (CON.md is the console). */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

function pathError(p: string, checkExt: boolean): string | undefined {
    if (p === '' || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) {
        return `Unsafe path "${p}": must be relative to the skill folder.`;
    }
    const segments = p.split('/');
    if (segments.some((seg) => seg === '..' || seg === '')) {
        return `Unsafe path "${p}": must not contain ".." or empty segments.`;
    }
    if (WINDOWS_INVALID_CHARS.test(p)) {
        return `Unsafe path "${p}": must not contain < > : " | ? * or control characters.`;
    }
    if (segments.some((seg) => WINDOWS_RESERVED_NAME.test(seg))) {
        return `Unsafe path "${p}": CON, PRN, AUX, NUL, COM0-9 and LPT0-9 are reserved file names on Windows.`;
    }
    if (checkExt && !ALLOWED_EXT.test(p)) {
        return `Path "${p}" is not allowed: only .yaml, .yml and .md files can be written.`;
    }
    return undefined;
}

/**
 * Normalize and validate a skill's files. `trusted` (shipped templates/examples/built-ins)
 * skips the extension allow-list and fence stripping; path safety is always enforced.
 */
export function normalizeFiles(
    files: SkillFileEntries,
    opts: { trusted?: boolean } = {},
): { files: SkillFiles; errors: string[] } {
    const out = new Map<string, string>();
    const seen = new Map<string, string>();
    const errors: string[] = [];
    for (const [rawKey, value] of files) {
        let key = rawKey.replace(/\\/g, '/');
        while (key.startsWith('./')) {
            key = key.slice(2);
        }
        const err = pathError(key, !opts.trusted);
        if (err) {
            errors.push(err);
            continue;
        }
        const prior = seen.get(key.toLowerCase());
        if (prior !== undefined) {
            errors.push(prior === rawKey
                ? `Duplicate file path "${rawKey}": each file may appear only once.`
                : `Duplicate file path "${rawKey}" (same as "${prior}" after normalization; paths are compared case-insensitively).`);
            continue;
        }
        seen.set(key.toLowerCase(), rawKey);
        out.set(key, opts.trusted ? value : stripWrappingFence(value));
    }
    if (!out.has('skill.yaml') && errors.length === 0) {
        errors.push('Missing required file "skill.yaml".');
    }
    return { files: out, errors };
}

/** A YAML scalar for `v`, quoted only if a plain scalar would read as something else. */
function yamlScalar(v: string): string {
    return yaml.dump(v, { lineWidth: -1 }).trimEnd();
}

export function rewriteIdentity(files: SkillFiles, identity: { id: string; name: string }): SkillFiles {
    const src = files.get('skill.yaml');
    if (src === undefined) {
        return files;
    }
    const lines = src.split('\n');
    let sawId = false;
    const rewritten = lines.map((line) => {
        if (/^id\s*:/.test(line)) {
            sawId = true;
            return `id: ${yamlScalar(identity.id)}`;
        }
        if (/^name\s*:/.test(line)) {
            return `name: ${yamlScalar(identity.name)}`;
        }
        return line;
    });
    if (!sawId) {
        rewritten.unshift(`id: ${yamlScalar(identity.id)}`);
    }
    const out = new Map(files);
    out.set('skill.yaml', rewritten.join('\n'));
    return out;
}

/** The top-level `id` in skill.yaml differs from the folder id (unparsable YAML is left to validation). */
export function yamlIdMismatch(files: SkillFiles, folderId: string): string | undefined {
    const src = files.get('skill.yaml');
    if (src === undefined) {
        return undefined;
    }
    let doc: unknown;
    try {
        doc = yaml.load(src);
    } catch {
        return undefined;
    }
    const id = doc && typeof doc === 'object' ? (doc as Record<string, unknown>).id : undefined;
    return id === undefined || id === folderId
        ? undefined
        : `skill.yaml declares id "${String(id)}" but the skill folder id is "${folderId}".`;
}

export function titleFromId(id: string): string {
    return id
        .split(/[-_]+/)
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' ');
}
