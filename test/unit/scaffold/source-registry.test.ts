import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyableBuiltins, listSources, type SourceEnv } from '../../../src/scaffold/sources/registry';
import { createMockSkill } from '../../helpers/mocks/skill';

const ext = '/ext';
function makeEnv(examples: string[]): SourceEnv {
    return {
        extensionPath: ext,
        builtins: [
            { id: 'b1', name: 'B One', description: 'first', dir: '/ext/skills/b1' },
            { id: 'b2', name: 'B Two', description: 'second', dir: '/ext/skills/b2' },
        ],
        listDirs: async (dir) => (dir === path.join(ext, '.skiller/skills') ? examples : []),
    };
}

describe('listSources', () => {
    it('lists templates, examples, built-ins in order', async () => {
        const all = await listSources(makeEnv(['change-map', 'shell-it']));
        expect(all.map((s) => s.kind)).toEqual([
            ...Array(5).fill('template'), 'example', 'example', 'builtin', 'builtin',
        ]);
        expect(all[0].dir).toBe(path.join(ext, 'templates', 'basic'));
        expect(all[7]).toMatchObject({ id: 'b1', label: 'B One', detail: 'first', dir: '/ext/skills/b1' });
    });

    it('filters by kind', async () => {
        const ex = await listSources(makeEnv(['change-map', 'shell-it']), ['example']);
        expect(ex.map((s) => s.dir)).toEqual([
            path.join(ext, '.skiller/skills', 'change-map'),
            path.join(ext, '.skiller/skills', 'shell-it'),
        ]);
        expect(ex.map((s) => s.label)).toEqual(['change-map', 'shell-it']);
    });

    it('tolerates a missing examples dir', async () => {
        const ex = await listSources(makeEnv([]), ['example']);
        expect(ex).toEqual([]);
    });
});

describe('copyableBuiltins', () => {
    it('maps built-ins to sources and drops those using built-in-only tools (a copy could not run)', () => {
        const greeter = createMockSkill({ id: 'greeter', name: 'Greeter', description: 'hi', source: { type: 'builtin', path: '/ext/skills/greeter' } });
        const creator = createMockSkill({
            id: 'skill-creator',
            source: { type: 'builtin', path: '/ext/skills/skill-creator' },
            tools: { aliases: { write: 'skiller_writeSkill' } },
        });
        expect(copyableBuiltins([greeter, creator])).toEqual([
            { id: 'greeter', name: 'Greeter', description: 'hi', dir: '/ext/skills/greeter' },
        ]);
    });
});
