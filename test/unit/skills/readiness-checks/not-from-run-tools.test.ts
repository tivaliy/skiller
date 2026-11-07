import { describe, it, expect } from 'vitest';
import { NotFromRunToolsCheck } from '../../../../src/skills/readiness/checks';
import { createReadinessEngine } from '../../../../src/skills/readiness';
import { NOT_FROM_RUN_TOOLS } from '../../../../src/skills/tool-policy';
import { createMockSkill, createMockStep } from '../../../helpers/mocks/skill';
import type { Skill } from '../../../../src/skills/types';
import type { ToolResolver } from '../../../../src/skills/tool-resolver';

const check = new NotFromRunToolsCheck();
const src = (type: Skill['source']['type']) => ({ type, path: '/x' });

describe('NotFromRunToolsCheck', () => {
    it('a skill aliasing skiller_runSkill fails readiness with the not-from-run message', () => {
        const skill = createMockSkill({ source: src('workspace'), tools: { aliases: { r: 'skiller_runSkill' } } });
        const r = check.check(skill, {});
        expect(r.ready).toBe(false);
        expect(r.issues).toHaveLength(1);
        expect(r.issues[0]).toMatchObject({
            checkId: 'not-from-run-tools',
            severity: 'error',
            message: "Tool 'skiller_runSkill' can't be used inside a Skiller run.",
        });
        expect(r.issues[0].suggestion).toBeTruthy();
    });

    it('applies to built-in skills too, and catches step references with the optional marker, once per tool', () => {
        const skill = createMockSkill({
            source: src('builtin'),
            steps: [
                createMockStep({ id: 'a', tools: ['skiller_listSkills?', 'skiller_runSkill'] }),
                createMockStep({ id: 'b', type: 'tool', tool: 'skiller_runSkill' }),
            ],
        });
        expect(check.check(skill, {}).issues.map((i) => i.message)).toEqual([
            "Tool 'skiller_listSkills' can't be used inside a Skiller run.",
            "Tool 'skiller_runSkill' can't be used inside a Skiller run.",
        ]);
    });

    it('ignores other Skiller tools', () => {
        const skill = createMockSkill({ source: src('workspace'), tools: { aliases: { c: 'skiller_createFile' } } });
        expect(check.check(skill, {})).toEqual({ ready: true, issues: [] });
    });

    it('lists exactly the run tools', () => {
        expect([...NOT_FROM_RUN_TOOLS].sort()).toEqual(['skiller_listSkills', 'skiller_runSkill']);
    });

    it('is registered in the default readiness engine', () => {
        const resolver = {
            findTool: (name: string) => ({ name }),
            validateReferences: () => ({ valid: true, missing: [], resolved: [] }),
        } as unknown as ToolResolver;
        const skill = createMockSkill({ source: src('workspace'), tools: { aliases: { r: 'skiller_runSkill' } } });
        const result = createReadinessEngine(resolver).checkReadiness(skill, {});
        expect(result.canRun).toBe(false);
        expect(result.errors.map((e) => e.checkId)).toContain('not-from-run-tools');
    });
});
