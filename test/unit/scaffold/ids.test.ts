import { describe, it, expect } from 'vitest';
import {
    checkNewId, suggestFreeId, normalizeFiles, rewriteIdentity, yamlIdMismatch, titleFromId,
} from '../../../src/scaffold/ids';

const m = (o: Record<string, string>) => new Map(Object.entries(o));

describe('checkNewId', () => {
    it('rejects bad format', () => expect(checkNewId('1abc', [])).toContain('must start with a letter'));
    it('rejects taken ids case-insensitively', () => {
        expect(checkNewId('greeter', ['greeter'])).toContain('already exists');
        expect(checkNewId('Greeter', ['greeter'])).toContain('already exists');
    });
    it('allows override of exactly that id', () => {
        expect(checkNewId('greeter', ['greeter'], { allowOverrideOf: 'greeter' })).toBeUndefined();
        expect(checkNewId('greeter', ['greeter', 'x'], { allowOverrideOf: 'x' })).toContain('already exists');
    });
    it('accepts a free valid id', () => expect(checkNewId('ok_id-1', ['a'])).toBeUndefined());
});

describe('suggestFreeId', () => {
    it('suggests -copy then -copy-N', () => {
        expect(suggestFreeId('foo', ['foo'])).toBe('foo-copy');
        expect(suggestFreeId('foo', ['foo', 'foo-copy'])).toBe('foo-copy-2');
        expect(suggestFreeId('foo', ['foo', 'FOO-COPY', 'foo-copy-2'])).toBe('foo-copy-3');
    });
});

describe('normalizeFiles', () => {
    it('normalizes keys and strips a wrapping fence', () => {
        const r = normalizeFiles(m({
            './steps/01.md': 'x', 'steps\\02.md': 'y', 'skill.yaml': '```yaml\nname: A\n```',
        }));
        expect([...r.files.keys()].sort()).toEqual(['skill.yaml', 'steps/01.md', 'steps/02.md']);
        expect(r.files.get('skill.yaml')).toBe('name: A\n');
        expect(r.errors).toEqual([]);
    });
    it('leaves inner fences alone', () => {
        const r = normalizeFiles(m({ 'skill.yaml': 'a: 1', 'a.md': 't\n```js\nx\n```\nend\n' }));
        expect(r.files.get('a.md')).toBe('t\n```js\nx\n```\nend\n');
    });
    it.each([
        '../x.md', '/abs/skill.yaml', 'C:/x.md', 'steps/run.sh',
        // Windows: ':' (alternate data streams), other invalid characters, reserved device names
        'steps/01.md:hidden.md', 'a?.md', 'a*.md', 'a|b.md', 'a"b.md', 'a<b.md',
        'CON.md', 'steps/nul.md', 'com1.md', 'LPT9.yaml', 'aux',
    ])('rejects %s', (p) => {
        const r = normalizeFiles(m({ 'skill.yaml': 'a: 1', [p]: 'x' }));
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0]).toContain(p);
    });
    it('requires skill.yaml', () => {
        const r = normalizeFiles(m({ 'a.md': 'x' }));
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0]).toContain('skill.yaml');
    });
});

describe('normalizeFiles (windows-safe names)', () => {
    it.each(['console.md', 'con-x.md', 'steps/com10.md', 'nul_notes.md'])('accepts %s', (p) => {
        expect(normalizeFiles(m({ 'skill.yaml': 'a: 1', [p]: 'x' })).errors).toEqual([]);
    });
});

describe('normalizeFiles (duplicates, trusted, fences)', () => {
    it('reports an exact duplicate path once, from a list of entries', () => {
        const r = normalizeFiles([['skill.yaml', 'a'], ['skill.yaml', 'b']]);
        expect(r.errors).toEqual(['Duplicate file path "skill.yaml": each file may appear only once.']);
    });
    it('reports normalization and case-only collisions', () => {
        const r = normalizeFiles(new Map([['skill.yaml', 'a'], ['a.md', '1'], ['./a.md', '2'], ['s/b.md', '1'], ['s\\b.md', '2'], ['Steps/A.md', '1'], ['steps/a.md', '2']]));
        expect(r.errors).toHaveLength(3);
        expect(r.errors.every((e) => e.includes('Duplicate'))).toBe(true);
    });
    it('trusted skips the extension allow-list but still enforces path safety', () => {
        expect(normalizeFiles(m({ 'skill.yaml': 'a: 1', 'data/x.json': '{}' }), { trusted: true }).errors).toEqual([]);
        expect(normalizeFiles(m({ 'skill.yaml': 'a: 1', '../x.json': '{}' }), { trusted: true }).errors).toHaveLength(1);
        expect(normalizeFiles(m({ 'skill.yaml': 'a: 1', '/x.json': '{}' }), { trusted: true }).errors).toHaveLength(1);
    });
    it('trusted leaves a fenced-start-and-end md unchanged', () => {
        const v = '```a\nx\n```\nmid\n```b\ny\n```\n';
        expect(normalizeFiles(m({ 'skill.yaml': 'a: 1', 'a.md': v }), { trusted: true }).files.get('a.md')).toBe(v);
    });
    it('untrusted two separate fenced blocks are unchanged; single wrapping fence still stripped', () => {
        const v = '```a\nx\n```\nmid\n```b\ny\n```\n';
        const r = normalizeFiles(m({ 'skill.yaml': 'a: 1', 'a.md': v }));
        expect(r.files.get('a.md')).toBe(v);
        expect(normalizeFiles(m({ 'skill.yaml': '```yaml\nname: A\n```' })).files.get('skill.yaml')).toBe('name: A\n');
    });
});

describe('checkNewId reserved words', () => {
    it.each(['true', 'False', 'NULL'])('rejects %s', (id) => {
        expect(checkNewId(id, [])).toBe(`"${id}" is a reserved word in YAML; pick another id.`);
    });
});

describe('rewriteIdentity', () => {
    const run = (y: string, id: { id: string; name: string }) =>
        rewriteIdentity(m({ 'skill.yaml': y }), id).get('skill.yaml');
    it('rewrites id and name preserving the rest', () => {
        expect(run('# c\nid: old\nname: Old\nsteps: []', { id: 'new', name: 'New' }))
            .toBe('# c\nid: new\nname: New\nsteps: []');
    });
    it('inserts id first when absent', () => {
        expect(run('name: Old\n', { id: 'new', name: 'New' })!.split('\n')[0]).toBe('id: new');
    });
    it('does not touch indented keys', () => {
        expect(run('id: a\nsteps:\n  id: keep\n  name: keep', { id: 'b', name: 'N' }))
            .toBe('id: b\nsteps:\n  id: keep\n  name: keep');
    });
    it('quotes values only when needed', () => {
        expect(run('id: a\nname: x', { id: 'a', name: 'A: B' })).toBe("id: a\nname: 'A: B'");
    });
});

describe('yamlIdMismatch', () => {
    it('is undefined for absent or equal id', () => {
        expect(yamlIdMismatch(m({ 'skill.yaml': 'name: x' }), 'a')).toBeUndefined();
        expect(yamlIdMismatch(m({ 'skill.yaml': 'id: a # c' }), 'a')).toBeUndefined();
        expect(yamlIdMismatch(m({ 'skill.yaml': 'id: "a"' }), 'a')).toBeUndefined();
    });
    it('reports a different id', () => {
        expect(yamlIdMismatch(m({ 'skill.yaml': 'id: b' }), 'a')).toContain('"b"');
    });
});

describe('titleFromId', () => {
    it('title-cases', () => expect(titleFromId('my-cool_skill')).toBe('My Cool Skill'));
});
