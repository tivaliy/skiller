import { describe, it, expect } from 'vitest';
import { ListSkillsTool } from '../../../src/tools/list-skills';
import type { Skill } from '../../../src/skills/types';

const token = { isCancellationRequested: false } as never;

function textOf(result: { content: unknown[] }): string {
    return result.content.map(p => (p as { value: string }).value).join('');
}

function skill(over: Partial<Skill> & { id: string }): Skill {
    return {
        name: over.id, description: `${over.id} desc`, version: '1.0.0', inputs: [],
        tools: { aliases: {} }, steps: [], onError: 'stop',
        source: { type: 'workspace', path: `/ws/${over.id}` },
        ...over
    } as Skill;
}

const list = async (skills: Skill[]) =>
    JSON.parse(textOf(await new ListSkillsTool({ skills: () => skills }).invoke({ input: {} } as never, token)));

describe('ListSkillsTool', () => {
    it('listSkills reports editor-bound inputs and write-back output', async () => {
        const out = await list([skill({
            id: 'rewrite',
            inputs: [
                { name: 'text', type: 'string', description: 'Text', required: true, from: 'selection' },
                { name: 'tone', type: 'string', description: 'Tone', required: false }
            ],
            output: { summary: 'x', to: 'replaceSelection' }
        }), skill({ id: 'plain', output: { summary: 'x' } })]);
        expect(out[0]).toEqual({
            id: 'rewrite', name: 'rewrite', description: 'rewrite desc',
            inputs: [
                { name: 'text', type: 'string', description: 'Text', required: true, editorBound: true },
                { name: 'tone', type: 'string', description: 'Tone', required: false, editorBound: false }
            ],
            writesToEditor: true
        });
        expect(out[1].writesToEditor).toBe(false);
    });

    it('excludes non-built-in skills that use built-in-only tools, keeps built-ins', async () => {
        const uses = { tools: { aliases: { w: 'skiller_writeSkill' } } };
        const out = await list([
            skill({ id: 'evil', ...uses }),
            skill({ id: 'skill-creator', source: { type: 'builtin', path: '/b' }, ...uses }),
            skill({ id: 'ok' })
        ]);
        expect(out.map((s: { id: string }) => s.id)).toEqual(['skill-creator', 'ok']);
    });

    it('excludes skills that use chat-only tools, built-ins included: no Skiller run has a chat session', async () => {
        const out = await list([
            skill({ id: 'explorer', tools: { aliases: { e: 'explore_subagent?' } } }),
            skill({ id: 'asker', source: { type: 'builtin', path: '/b' }, steps: [{ id: 's', type: 'tool', tool: 'vscode_askQuestions' }] as Skill['steps'] }),
            skill({ id: 'ok' })
        ]);
        expect(out.map((s: { id: string }) => s.id)).toEqual(['ok']);
    });
});
