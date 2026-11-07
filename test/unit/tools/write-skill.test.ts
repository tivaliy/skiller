import { describe, it, expect, vi } from 'vitest';
import { WriteSkillTool, type WriteSkillDeps } from '../../../src/tools/write-skill';
import { isToolResultError } from '../../../src/skills/handlers/runners/llm-runner';

const token = { isCancellationRequested: false } as never;

function textOf(result: { content: unknown[] }): string {
    return result.content.map(p => (p as { value: string }).value).join('');
}

function make(overrides: Partial<WriteSkillDeps> = {}) {
    const deps: WriteSkillDeps = {
        commit: vi.fn().mockResolvedValue({ ok: true, id: 'my-skill', dir: '/ws/.skiller/skills/my-skill', tier: 'workspace' }),
        finish: vi.fn().mockResolvedValue(undefined),
        ...overrides
    };
    return { deps, tool: new WriteSkillTool(deps) };
}

const input = { id: 'my-skill', files: [{ path: 'skill.yaml', content: 'a: 1' }] };

describe('WriteSkillTool', () => {
    it('reports success, passes files as entries and finishes once', async () => {
        const { deps, tool } = make();
        const text = textOf(await tool.invoke({ input } as never, token));
        expect(text.startsWith('Skill written:')).toBe(true);
        expect(text).toContain('my-skill');
        expect(text).toContain('/ws/.skiller/skills/my-skill');
        // finish is fire-and-forget: the text must not claim it already happened.
        expect(text).toContain('It will be registered and opened for the user.');
        expect(text).not.toContain('is now registered');
        expect(deps.finish).toHaveBeenCalledTimes(1);
        expect(deps.finish).toHaveBeenCalledWith({ id: 'my-skill', dir: '/ws/.skiller/skills/my-skill', tier: 'workspace' });
        expect(vi.mocked(deps.commit).mock.calls[0][1]).toEqual([['skill.yaml', 'a: 1']]);
    });

    it('lists errors on failure and does not finish', async () => {
        const { deps, tool } = make({ commit: vi.fn().mockResolvedValue({ ok: false, errors: ['a', 'b'] }) });
        const text = textOf(await tool.invoke({ input } as never, token));
        expect(text.startsWith('Skill not written:')).toBe(true);
        expect(text).toContain('- a');
        expect(text).toContain('- b');
        expect(text).toMatch(/fix .*call skiller_writeSkill again/i);
        expect(deps.finish).not.toHaveBeenCalled();
        expect(isToolResultError(text)).toBe(false);
    });

    it('success text matches no tool error pattern', async () => {
        const { tool } = make();
        const text = textOf(await tool.invoke({ input } as never, token));
        expect(isToolResultError(text)).toBe(false);
    });

    it('swallows a rejecting finish', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { tool } = make({ finish: vi.fn().mockRejectedValue(new Error('boom')) });
        const text = textOf(await tool.invoke({ input } as never, token));
        expect(text.startsWith('Skill written:')).toBe(true);
    });

    it('survives a synchronously throwing finish', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { tool } = make({ finish: vi.fn(() => { throw new Error('boom'); }) });
        const text = textOf(await tool.invoke({ input } as never, token));
        expect(text.startsWith('Skill written:')).toBe(true);
        await new Promise(r => setTimeout(r, 0));
        expect(warn).toHaveBeenCalled();
    });

    it('returns Skill not written when commit throws', async () => {
        const { deps, tool } = make({ commit: vi.fn().mockRejectedValue(new Error('disk')) });
        const text = textOf(await tool.invoke({ input } as never, token));
        expect(text.startsWith('Skill not written:')).toBe(true);
        expect(text).toContain('- disk');
        expect(deps.finish).not.toHaveBeenCalled();
        expect(isToolResultError(text)).toBe(false);
    });

    it('has no confirmation messages', async () => {
        const { tool } = make();
        const prepared = await tool.prepareInvocation({ input } as never, token);
        expect(prepared).not.toHaveProperty('confirmationMessages');
    });

    it('returns Skill not written for malformed input', async () => {
        const { deps, tool } = make();
        const text = textOf(await tool.invoke({ input: { id: 'x' } } as never, token));
        expect(text.startsWith('Skill not written:')).toBe(true);
        expect(deps.commit).not.toHaveBeenCalled();
        expect(isToolResultError(text)).toBe(false);
    });

    it('retry trailer says to change the id only when it already exists', async () => {
        const { tool } = make({ commit: vi.fn().mockResolvedValue({ ok: false, errors: ['x'] }) });
        const text = textOf(await tool.invoke({ input } as never, token));
        expect(text).toContain('already exists');
        expect(text).not.toContain('is taken');
    });

    it('passes every file entry to commit, so duplicates are caught by its single check', async () => {
        const { deps, tool } = make();
        const dup = { id: 'my-skill', files: [{ path: 'skill.yaml', content: 'a' }, { path: 'skill.yaml', content: 'b' }] };
        await tool.invoke({ input: dup } as never, token);
        expect(vi.mocked(deps.commit).mock.calls[0][1]).toEqual([['skill.yaml', 'a'], ['skill.yaml', 'b']]);
    });

    it('does not write when the request is already cancelled', async () => {
        const { deps, tool } = make();
        const text = textOf(await tool.invoke({ input } as never, { isCancellationRequested: true } as never));
        expect(text).toBe('Skill not written: the request was cancelled.');
        expect(deps.commit).not.toHaveBeenCalled();
        expect(isToolResultError(text)).toBe(false);
    });
});
