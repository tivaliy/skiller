import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNewSkillFlow, type FlowDeps, type ScaffoldUi } from '../../../src/scaffold/flow';
import type { NewSkillKind } from '../../../src/scaffold/kinds';
import type { ScaffoldSource, SourceEnv } from '../../../src/scaffold/sources/registry';
import * as yaml from 'js-yaml';
import { createNodeScaffoldFs } from '../../helpers/node-scaffold-fs';

const EXT = process.cwd();
let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skiller-flow-'));
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

const env: SourceEnv = {
    extensionPath: EXT,
    builtins: [
        { id: 'greeter', name: 'Greeter', description: 'd', dir: path.join(EXT, 'skills/greeter') },
        { id: 'mind-reader', name: 'Mind Reader', description: 'd', dir: path.join(EXT, 'skills/mind-reader') },
    ],
    listDirs: async (dir) =>
        fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [],
};

function setup(opts: {
    kind?: NewSkillKind;
    pick?: (s: ScaffoldSource[]) => ScaffoldSource | undefined;
    ids?: Array<string | undefined>;
    taken?: string[];
    errors?: string[];
}) {
    const ids = [...(opts.ids ?? [])];
    const ui = {
        pickKind: vi.fn(async () => opts.kind),
        pickSource: vi.fn(async (s: ScaffoldSource[]) => (opts.pick ? opts.pick(s) : undefined)),
        askId: vi.fn(async (_s: string, _v: (id: string) => string | undefined) => ids.shift()),
        openDescribe: vi.fn(async () => {}),
        showErrors: vi.fn(),
    } satisfies ScaffoldUi;
    const finish = vi.fn(async () => {});
    const deps: FlowDeps = {
        ui,
        env,
        fs: createNodeScaffoldFs(),
        target: { root, tier: 'workspace' },
        takenIds: () => opts.taken ?? [],
        validate: async () => opts.errors ?? [],
        finish,
    };
    return { ui, finish, deps };
}

describe('runNewSkillFlow', () => {
    it('template path writes the skill and finishes', async () => {
        const { deps, finish, ui } = setup({ kind: 'template', pick: (s) => s.find((x) => x.id === 'basic'), ids: ['my-skill'] });
        const r = await runNewSkillFlow(deps);
        expect(r).toMatchObject({ ok: true, id: 'my-skill' });
        expect(ui.pickSource.mock.calls[0][0].every((s) => s.kind === 'template')).toBe(true);
        const yaml = fs.readFileSync(path.join(root, 'my-skill', 'skill.yaml'), 'utf8');
        expect(yaml).toContain('id: my-skill');
        expect(yaml).toContain('name: My Skill');
        expect(finish).toHaveBeenCalledTimes(1);
        expect(finish).toHaveBeenCalledWith({ id: 'my-skill', dir: path.join(root, 'my-skill'), tier: 'workspace', overridesBuiltin: false });
    });

    it.each(['true-', 'null_', 'false-'])('template id %s keeps id and name as YAML strings', async (id) => {
        const { deps } = setup({ kind: 'template', pick: (s) => s.find((x) => x.id === 'basic'), ids: [id] });
        const r = await runNewSkillFlow(deps);
        expect(r).toMatchObject({ ok: true, id });
        const doc = yaml.load(fs.readFileSync(path.join(root, id, 'skill.yaml'), 'utf8')) as Record<string, unknown>;
        expect(doc.id).toBe(id);
        expect(typeof doc.name).toBe('string');
    });

    it('copy with sourceKind builtin copies the built-in even when an example shares its id', async () => {
        const { deps } = setup({});
        deps.env = { ...env, builtins: [{ id: 'change-map', name: 'CM', description: 'd', dir: path.join(EXT, 'skills/greeter') }] };
        const readTree = vi.spyOn(deps.fs, 'readTree');
        await runNewSkillFlow(deps, 'copy', 'change-map', 'builtin');
        expect(readTree).toHaveBeenCalledWith(path.join(EXT, 'skills/greeter'));
    });

    it('the template flow lists only templates (examples folder is not read)', async () => {
        const { deps } = setup({ kind: 'template', pick: () => undefined });
        const listDirs = vi.fn(env.listDirs);
        deps.env = { ...env, listDirs };
        await runNewSkillFlow(deps);
        expect(listDirs).not.toHaveBeenCalled();
    });

    it('a source that cannot be read is reported, not thrown', async () => {
        const { deps, ui, finish } = setup({ kind: 'copy', pick: (s) => s.find((x) => x.id === 'greeter') });
        deps.fs = { ...deps.fs, readTree: async () => { throw new Error('"logo.png" is not UTF-8 text; only text files can be copied.'); } };
        const r = await runNewSkillFlow(deps);
        expect(r).toEqual({ ok: false, errors: ['"logo.png" is not UTF-8 text; only text files can be copied.'] });
        expect(ui.showErrors).toHaveBeenCalledWith(['"logo.png" is not UTF-8 text; only text files can be copied.']);
        expect(finish).not.toHaveBeenCalled();
    });

    it('describe opens chat and returns undefined', async () => {
        const { deps, ui, finish } = setup({ kind: 'describe' });
        expect(await runNewSkillFlow(deps)).toBeUndefined();
        expect(ui.openDescribe).toHaveBeenCalledTimes(1);
        expect(finish).not.toHaveBeenCalled();
    });

    it.each([
        ['pickKind', { kind: undefined }],
        ['pickSource', { kind: 'template' as const, pick: () => undefined }],
        ['askId', { kind: 'template' as const, pick: (s: ScaffoldSource[]) => s[0], ids: [undefined] }],
    ])('cancel at %s writes nothing', async (_n, opts) => {
        const { deps, ui, finish } = setup(opts);
        expect(await runNewSkillFlow(deps)).toBeUndefined();
        expect(fs.readdirSync(root)).toEqual([]);
        expect(finish).not.toHaveBeenCalled();
        expect(ui.showErrors).not.toHaveBeenCalled();
    });

    it('copy of a built-in keeps the id and overrides', async () => {
        const { deps, ui } = setup({ kind: 'copy', pick: (s) => s.find((x) => x.id === 'greeter'), taken: ['greeter'] });
        const r = await runNewSkillFlow(deps);
        expect(r).toMatchObject({ ok: true, id: 'greeter' });
        expect(ui.askId).not.toHaveBeenCalled();
        expect(fs.readFileSync(path.join(root, 'greeter', 'skill.yaml'), 'utf8')).toMatch(/^id: greeter$/m);
    });

    it('reports overridesBuiltin when a built-in copy keeps its id via the pickers', async () => {
        const { deps, finish } = setup({ kind: 'copy', pick: (s) => s.find((x) => x.id === 'greeter') });
        await runNewSkillFlow(deps);
        expect(finish).toHaveBeenCalledWith(expect.objectContaining({ id: 'greeter', overridesBuiltin: true }));
    });

    it('copy of a taken example asks for a free id and rewrites identity', async () => {
        const { deps, ui } = setup({
            kind: 'copy',
            pick: (s) => s.find((x) => x.id === 'change-map'),
            taken: ['change-map'],
            ids: ['change-map-copy'],
        });
        const r = await runNewSkillFlow(deps);
        expect(r).toMatchObject({ ok: true, id: 'change-map-copy' });
        expect(ui.askId.mock.calls[0][0]).toBe('change-map-copy');
        const yaml = fs.readFileSync(path.join(root, 'change-map-copy', 'skill.yaml'), 'utf8');
        expect(yaml).toMatch(/^id: change-map-copy$/m);
        expect(yaml).toMatch(/^name: Change Map Copy$/m);
    });

    it('validation errors are shown and finish is skipped', async () => {
        const { deps, ui, finish } = setup({
            kind: 'template',
            pick: (s) => s[0],
            ids: ['bad-one'],
            errors: ['boom'],
        });
        const r = await runNewSkillFlow(deps);
        expect(r).toEqual({ ok: false, errors: ['boom'] });
        expect(ui.showErrors).toHaveBeenCalledWith(['boom']);
        expect(finish).not.toHaveBeenCalled();
    });

    it('kind + sourceId skips pickKind and pickSource', async () => {
        const { deps, ui } = setup({});
        const r = await runNewSkillFlow(deps, 'copy', 'mind-reader');
        expect(r).toMatchObject({ ok: true, id: 'mind-reader' });
        expect(ui.pickKind).not.toHaveBeenCalled();
        expect(ui.pickSource).not.toHaveBeenCalled();
    });

    it('template path re-prompts when the id folder already exists (unregistered), leaving it untouched', async () => {
        fs.mkdirSync(path.join(root, 'my-skill'));
        fs.writeFileSync(path.join(root, 'my-skill', 'keep.md'), 'mine');
        const { deps, ui } = setup({ kind: 'template', pick: (s) => s.find((x) => x.id === 'basic'), ids: ['my-skill', 'my-skill-2'] });
        const r = await runNewSkillFlow(deps);
        expect(r).toMatchObject({ ok: true, id: 'my-skill-2' });
        expect(ui.askId).toHaveBeenCalledTimes(2);
        const secondValidate = ui.askId.mock.calls[1][1];
        expect(secondValidate('my-skill')).toContain('already exists');
        expect(secondValidate('fresh-id')).toBeUndefined();
        expect(fs.readdirSync(path.join(root, 'my-skill'))).toEqual(['keep.md']);
        expect(ui.showErrors).not.toHaveBeenCalled();
    });

    it('copy of an example whose folder already exists asks for another id', async () => {
        fs.mkdirSync(path.join(root, 'change-map'));
        const { deps, ui } = setup({ kind: 'copy', pick: (s) => s.find((x) => x.id === 'change-map'), ids: ['change-map-copy'] });
        const r = await runNewSkillFlow(deps);
        expect(r).toMatchObject({ ok: true, id: 'change-map-copy' });
        expect(ui.askId).toHaveBeenCalledTimes(1);
        expect(fs.readdirSync(path.join(root, 'change-map'))).toEqual([]);
    });

    it('copy of a source id that is not offered (e.g. an already-overridden built-in) says it is not available', async () => {
        const { deps, ui, finish } = setup({ taken: ['greeter'] });
        deps.env = { ...env, builtins: env.builtins.filter((b) => b.id !== 'greeter') };
        expect(await runNewSkillFlow(deps, 'copy', 'greeter')).toBeUndefined();
        expect(ui.showErrors).toHaveBeenCalledTimes(1);
        const [message] = ui.showErrors.mock.calls[0][0];
        expect(message).toContain('"greeter" is not available to copy');
        expect(message).toContain('overridden in your workspace or user skills');
        expect(finish).not.toHaveBeenCalled();
        expect(fs.readdirSync(root)).toEqual([]);
    });

    it('an unknown kind argument does not throw and shows the kind picker', async () => {
        const { deps, ui } = setup({ kind: undefined });
        await expect(runNewSkillFlow(deps, 'bogus' as NewSkillKind)).resolves.toBeUndefined();
        expect(ui.pickKind).toHaveBeenCalledTimes(1);
        expect(ui.showErrors).not.toHaveBeenCalled();
    });

    it('copy of a built-in whose folder exists on disk re-prompts and rewrites identity (no override)', async () => {
        fs.mkdirSync(path.join(root, 'greeter'));
        const { deps, ui, finish } = setup({ kind: 'copy', pick: (s) => s.find((x) => x.id === 'greeter'), taken: ['greeter'], ids: ['greeter-copy'] });
        const r = await runNewSkillFlow(deps);
        expect(r).toMatchObject({ ok: true, id: 'greeter-copy' });
        expect(finish).toHaveBeenCalledWith(expect.objectContaining({ id: 'greeter-copy', overridesBuiltin: false }));
        expect(ui.askId.mock.calls[0][0]).toBe('greeter-copy');
        expect(fs.readFileSync(path.join(root, 'greeter-copy', 'skill.yaml'), 'utf8')).toMatch(/^id: greeter-copy$/m);
        expect(fs.readdirSync(path.join(root, 'greeter'))).toEqual([]);
    });

    it('copy of a built-in whose id the user then reuses is not an override of a taken id', async () => {
        fs.mkdirSync(path.join(root, 'greeter'));
        const { deps } = setup({ kind: 'copy', pick: (s) => s.find((x) => x.id === 'greeter'), taken: ['greeter', 'greeter-copy'], ids: ['greeter-copy'] });
        const r = await runNewSkillFlow(deps);
        expect(r?.ok).toBe(false);
    });
});
