import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/scaffold/commit', () => ({ commitSkill: vi.fn().mockResolvedValue({ ok: true, id: 'x', dir: '/d' }) }));

import { createWriteSkillDeps } from '../../../src/scaffold/write-skill-deps';
import { commitSkill } from '../../../src/scaffold/commit';

describe('createWriteSkillDeps', () => {
    it('computes target and takenIds per commit; finish forwards the committed tier', async () => {
        let ws: string | undefined = '/ws/skills';
        let ids = ['a'];
        const registry = {
            getWorkspaceSkillsPath: () => ws,
            getUserSkillsPath: () => '/user/skills',
            getAll: () => ids.map(id => ({ id }))
        };
        const finish = vi.fn().mockResolvedValue(undefined);
        const deps = createWriteSkillDeps(registry as never, finish);
        const files = new Map<string, string>();

        await deps.commit('x', files);
        ws = undefined;
        ids = ['a', 'b'];
        await deps.commit('x', files);
        // A workspace opened after the write must not change what finish reports:
        // finish forwards the tier the commit used.
        ws = '/ws/skills';
        await deps.finish({ id: 'x', dir: '/user/skills/x', tier: 'user' });

        const commits = vi.mocked(commitSkill).mock.calls;
        expect(commits[0][2]).toEqual({ root: '/ws/skills', tier: 'workspace' });
        expect(commits[0][3].takenIds).toEqual(['a']);
        expect(commits[1][2]).toEqual({ root: '/user/skills', tier: 'user' });
        expect(commits[1][3].takenIds).toEqual(['a', 'b']);

        const finishes = finish.mock.calls;
        expect(finishes).toHaveLength(1);
        expect(finishes[0][0]).toEqual({ id: 'x', dir: '/user/skills/x', tier: 'user' });
    });
});
