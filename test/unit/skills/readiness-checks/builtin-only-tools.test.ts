import { describe, it, expect } from 'vitest';
import { BuiltinOnlyToolsCheck } from '../../../../src/skills/readiness/checks';
import { createMockSkill, createMockStep } from '../../../helpers/mocks/skill';
import type { Skill } from '../../../../src/skills/types';

const check = new BuiltinOnlyToolsCheck();
const src = (type: Skill['source']['type']) => ({ type, path: '/x' });

describe('BuiltinOnlyToolsCheck', () => {
    it.each(['workspace', 'user'] as const)('rejects a %s skill that aliases skiller_writeSkill', (type) => {
        const skill = createMockSkill({ source: src(type), tools: { aliases: { w: 'skiller_writeSkill' } } });
        const r = check.check(skill, {});
        expect(r.ready).toBe(false);
        expect(r.issues).toHaveLength(1);
        expect(r.issues[0]).toMatchObject({ checkId: 'builtin-only-tools', severity: 'error' });
        expect(r.issues[0].message).toContain('skiller_writeSkill');
        expect(r.issues[0].message).toContain('built-in');
    });

    it('rejects optional aliases and direct references in step.tools and step.tool', () => {
        const skill = createMockSkill({
            source: src('workspace'),
            tools: { aliases: { w: 'skiller_writeSkill?' } },
            steps: [
                createMockStep({ id: 'a', tools: ['skiller_writeSkill?'] }),
                createMockStep({ id: 'b', type: 'tool', tool: 'skiller_writeSkill' }),
            ],
        });
        const r = check.check(skill, {});
        expect(r.ready).toBe(false);
        expect(r.issues).toHaveLength(1); // reported once per tool
    });

    it('allows built-in skills', () => {
        const skill = createMockSkill({ source: src('builtin'), tools: { aliases: { w: 'skiller_writeSkill' } } });
        expect(check.check(skill, {})).toEqual({ ready: true, issues: [] });
    });

    it('ignores other tools', () => {
        const skill = createMockSkill({ source: src('workspace'), tools: { aliases: { c: 'skiller_createFile' } } });
        expect(check.check(skill, {}).ready).toBe(true);
    });
});
