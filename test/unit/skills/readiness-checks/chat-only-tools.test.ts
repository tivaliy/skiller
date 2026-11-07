import { describe, it, expect } from 'vitest';
import { ChatOnlyToolsCheck } from '../../../../src/skills/readiness/checks';
import { createReadinessEngine } from '../../../../src/skills/readiness';
import { CHAT_ONLY_TOOLS } from '../../../../src/skills/tool-policy';
import { createMockSkill, createMockStep } from '../../../helpers/mocks/skill';
import type { Skill } from '../../../../src/skills/types';
import type { ToolResolver } from '../../../../src/skills/tool-resolver';

const check = new ChatOnlyToolsCheck();
const src = (type: Skill['source']['type']) => ({ type, path: '/x' });

describe('ChatOnlyToolsCheck', () => {
    it('a skill aliasing search_subagent fails readiness with the chat-only message', () => {
        const skill = createMockSkill({ source: src('workspace'), tools: { aliases: { s: 'search_subagent' } } });
        const r = check.check(skill, {});
        expect(r.ready).toBe(false);
        expect(r.issues).toHaveLength(1);
        expect(r.issues[0]).toMatchObject({
            checkId: 'chat-only-tools',
            severity: 'error',
            message: "Tool 'search_subagent' only works inside VS Code chat sessions.",
        });
    });

    it('applies to built-in skills too: no Skiller run has a chat session', () => {
        const skill = createMockSkill({ source: src('builtin'), tools: { aliases: { e: 'copilot_editFiles' } } });
        expect(check.check(skill, {}).ready).toBe(false);
    });

    it('catches optional aliases and direct references in step.tools and step.tool, once per tool', () => {
        const skill = createMockSkill({
            source: src('user'),
            tools: { aliases: { q: 'vscode_askQuestions?' } },
            steps: [
                createMockStep({ id: 'a', tools: ['vscode_askQuestions?', 'explore_subagent'] }),
                createMockStep({ id: 'b', type: 'tool', tool: 'explore_subagent' }),
            ],
        });
        const r = check.check(skill, {});
        expect(r.issues.map((i) => i.message)).toEqual([
            "Tool 'vscode_askQuestions' only works inside VS Code chat sessions.",
            "Tool 'explore_subagent' only works inside VS Code chat sessions.",
        ]);
    });

    it('points Copilot file writers at Skiller\'s own file tools, and only them', () => {
        const skill = createMockSkill({ source: src('workspace'), tools: { aliases: { e: 'copilot_editFiles', s: 'search_subagent' } } });
        const [edit, search] = check.check(skill, {}).issues;
        expect(edit.suggestion).toContain('skiller_replaceInFile');
        expect(search.suggestion).not.toContain('skiller_');
    });

    it('ignores tools that work in Skiller runs', () => {
        const skill = createMockSkill({ source: src('workspace'), tools: { aliases: { c: 'skiller_createFile' } } });
        expect(check.check(skill, {})).toEqual({ ready: true, issues: [] });
    });

    it.each([
        'copilot_createFile', 'copilot_editFiles', 'search_subagent', 'explore_subagent',
        'execution_subagent', 'vscode_askQuestions', 'vscode_reviewPlan',
    ])('treats %s (found by the spike) as chat-only', (name) => {
        expect(CHAT_ONLY_TOOLS.has(name)).toBe(true);
    });

    it('is registered in the default readiness engine', () => {
        // Every tool is installed, so only the chat-only check can fail the skill.
        const resolver = {
            findTool: (name: string) => ({ name }),
            validateReferences: () => ({ valid: true, missing: [], resolved: [] }),
        } as unknown as ToolResolver;
        const skill = createMockSkill({ source: src('workspace'), tools: { aliases: { s: 'search_subagent' } } });
        const result = createReadinessEngine(resolver).checkReadiness(skill, {});
        expect(result.canRun).toBe(false);
        expect(result.errors.map((e) => e.checkId)).toContain('chat-only-tools');
    });
});
