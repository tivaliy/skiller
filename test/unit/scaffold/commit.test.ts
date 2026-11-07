import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitSkill } from '../../../src/scaffold/commit';
import type { ScaffoldFs, SkillFiles } from '../../../src/scaffold/types';
import { createNodeScaffoldFs } from '../../helpers/node-scaffold-fs';

describe('commitSkill', () => {
    let base: string;
    let root: string;
    const nodeFs = createNodeScaffoldFs();
    const ok = async () => [] as string[];
    const files = (yaml = 'id: foo\nname: Foo\n'): SkillFiles =>
        new Map([['skill.yaml', yaml], ['steps/01.md', 'hello']]);
    const deps = (over: Partial<Parameters<typeof commitSkill>[3]> = {}) => ({
        fs: nodeFs,
        validate: ok,
        takenIds: [] as string[],
        ...over,
    });
    const target = () => ({ root, tier: 'workspace' as const });
    const rootEntries = () => (fs.existsSync(root) ? fs.readdirSync(root) : []);

    beforeEach(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-'));
        root = path.join(base, 'skills');
    });
    afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

    it('writes files and leaves no staging dir (root created on demand)', async () => {
        const r = await commitSkill('foo', files(), target(), deps());
        expect(r).toEqual({ ok: true, id: 'foo', dir: path.join(root, 'foo'), tier: 'workspace' });
        expect(fs.readFileSync(path.join(root, 'foo/steps/01.md'), 'utf8')).toBe('hello');
        expect(rootEntries()).toEqual(['foo']);
    });

    it('returns validation errors and cleans up', async () => {
        const r = await commitSkill('foo', files(), target(), deps({ validate: async () => ['steps[0]: bad'] }));
        expect(r).toEqual({ ok: false, errors: ['steps[0]: bad'] });
        expect(rootEntries()).toEqual([]);
    });

    it('refuses when the final dir exists, leaving it untouched', async () => {
        fs.mkdirSync(path.join(root, 'foo'), { recursive: true });
        fs.writeFileSync(path.join(root, 'foo/keep.md'), 'x');
        const r = await commitSkill('foo', files(), target(), deps());
        expect(r.ok).toBe(false);
        expect(rootEntries()).toEqual(['foo']);
        expect(fs.readdirSync(path.join(root, 'foo'))).toEqual(['keep.md']);
    });

    it('rejects case-insensitive id clashes unless override allowed', async () => {
        expect((await commitSkill('foo', files(), target(), deps({ takenIds: ['Foo'] }))).ok).toBe(false);
        const r = await commitSkill('foo', files(), target(), deps({ takenIds: ['Foo'], allowOverrideOf: 'foo' }));
        expect(r.ok).toBe(true);
    });

    it('rejects a skill.yaml id mismatch', async () => {
        const r = await commitSkill('foo', files('id: bar\n'), target(), deps());
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.errors[0]).toContain('bar');
        }
        expect(rootEntries()).toEqual([]);
    });

    it('cleans up staging when a write throws midway', async () => {
        let n = 0;
        const failing: ScaffoldFs = {
            ...nodeFs,
            writeFile: async (p, c) => {
                if (++n === 2) {
                    throw new Error('disk full');
                }
                return nodeFs.writeFile(p, c);
            },
        };
        const r = await commitSkill('foo', files(), target(), deps({ fs: failing }));
        expect(r).toEqual({ ok: false, errors: ['disk full'] });
        expect(rootEntries()).toEqual([]);
    });

    it('never reuses a pre-existing staging dir: regenerates the suffix and leaves it intact', async () => {
        const suffix = (n: number) => n.toString(36).slice(2, 10);
        const clash = path.join(root, `.foo.staging-${suffix(0.5)}`);
        fs.mkdirSync(clash, { recursive: true });
        fs.writeFileSync(path.join(clash, 'marker.md'), 'not ours');
        vi.spyOn(Math, 'random').mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);
        const r = await commitSkill('foo', files(), target(), deps());
        expect(r).toEqual({ ok: true, id: 'foo', dir: path.join(root, 'foo'), tier: 'workspace' });
        expect(fs.readdirSync(clash)).toEqual(['marker.md']);
        expect(fs.readdirSync(path.join(root, 'foo')).sort()).toEqual(['skill.yaml', 'steps']);
        expect(rootEntries().sort()).toEqual([`.foo.staging-${suffix(0.5)}`, 'foo']);
    });

    it('returns validation errors even when removing staging throws', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const throwingFs: ScaffoldFs = { ...nodeFs, rm: async () => { throw new Error('rm boom'); } };
        const r = await commitSkill('foo', files(), target(), deps({ fs: throwingFs, validate: async () => ['bad step'] }));
        expect(r).toEqual({ ok: false, errors: ['bad step'] });
        expect(warn).toHaveBeenCalled();
    });

    it('trusted copies keep non-allow-listed files; untrusted rejects them', async () => {
        const f: SkillFiles = new Map([['skill.yaml', 'id: foo\nname: Foo\n'], ['data/x.json', '{}']]);
        expect((await commitSkill('foo', f, target(), deps({ trusted: true }))).ok).toBe(true);
        expect(fs.readFileSync(path.join(root, 'foo/data/x.json'), 'utf8')).toBe('{}');
        const r = await commitSkill('bar', new Map([['skill.yaml', 'id: bar\n'], ['data/x.json', '{}']]), target(), deps());
        expect(r.ok).toBe(false);
    });
});
