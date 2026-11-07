/**
 * Tests for command presenters (S-18: chat-markdown rendering moved out of the
 * data classes). formatToolStatus cases are ported from the old ToolCache tests;
 * the skill-list/details cases are new (the registry never had presentation tests).
 */

import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { formatSkillList, formatSkillDetails, formatToolStatus, formatNewSkillMenu } from '../../../src/commands/presenters';
import { ToolCache, ToolsProvider } from '../../../src/ToolCache';
import type { Skill, SkillRegistry, DiscoveredSkills } from '../../../src/skills';
import { createMockSkill, createMockStep } from '../../helpers/mocks/skill';

function toolCacheWith(names: string[]): ToolCache {
    const tools = names.map(name => ({
        name,
        description: 'd',
        inputSchema: { type: 'object', properties: {}, required: [] }
    }));
    const provider: ToolsProvider = () => tools as unknown as readonly vscode.LanguageModelToolInformation[];
    const cache = new ToolCache(provider);
    cache.refresh();
    return cache;
}

/** Minimal SkillRegistry stand-in exposing only what formatSkillList uses. */
function fakeRegistry(skills: Skill[]): SkillRegistry {
    const bySource: { builtin: Skill[]; user: Skill[]; workspace: Skill[] } = {
        builtin: [], user: [], workspace: []
    };
    for (const s of skills) bySource[s.source.type].push(s);

    const discovered: DiscoveredSkills = {
        skills: new Map(skills.map(s => [s.id, s])),
        builtin: bySource.builtin,
        user: bySource.user,
        workspace: bySource.workspace,
        overrides: [],
        parseErrors: []
    };

    return {
        getDiscoveredSkills: () => discovered,
        getBySource: () => bySource
    } as unknown as SkillRegistry;
}

describe('formatToolStatus', () => {
    it('returns a "not configured" message when no tools', () => {
        expect(formatToolStatus(toolCacheWith([]))).toContain('Not configured');
    });

    it('lists categories when tools are available', () => {
        const markdown = formatToolStatus(toolCacheWith([
            'mcp_mcp-acme_item_search',
            'mcp__github__get_file'
        ]));
        expect(markdown).toContain('Tools Available');
        expect(markdown).toContain('Acme');
        expect(markdown).toContain('Github');
    });
});

describe('formatSkillList', () => {
    it('shows a "no skills" message when empty', () => {
        const output = formatSkillList(fakeRegistry([]));
        expect(output).toContain('No skills found');
    });

    it('lists skills grouped by source with Run/View actions', () => {
        const output = formatSkillList(fakeRegistry([
            createMockSkill({ id: 'greeter', description: 'Say hi' })
        ]));
        expect(output).toContain('Built-in');
        expect(output).toContain('greeter');
        expect(output).toContain('Run');
        expect(output).toContain('View');
        // Command links target the chat-open command
        expect(output).toContain('command:workbench.action.chat.open');
    });
});

describe('formatSkillDetails', () => {
    it('renders name, version, source, and steps', () => {
        const skill = createMockSkill({
            name: 'Greeter',
            version: '2.0.0',
            steps: [
                { id: 'greet', type: 'llm', file: 'steps/01.md' },
                { id: 'maybe', type: 'llm', file: 'steps/02.md', when: 'inputs.x' }
            ]
        });
        const output = formatSkillDetails(skill);
        expect(output).toContain('## Greeter');
        expect(output).toContain('v2.0.0');
        expect(output).toContain('Built-in');
        expect(output).toContain('greet');
        expect(output).toContain('conditional step'); // legend appears for `when` steps
    });
});

describe('formatSkillList copy action', () => {
    it('offers Copy only on built-in skills', () => {
        const mk = (id: string, type: 'builtin' | 'user' | 'workspace') =>
            createMockSkill({ id, source: { type, path: `/x/${id}` } });
        const out = formatSkillList(fakeRegistry([mk('b1', 'builtin'), mk('u1', 'user'), mk('w1', 'workspace')]));
        const line = (id: string) => out.split('\n').find(l => l.includes(`\`${id}\``))!;
        expect(line('b1')).toContain('command:skiller.copySkill');
        expect(line('u1')).not.toContain('command:skiller.copySkill');
        expect(line('w1')).not.toContain('command:skiller.copySkill');
    });

    it('does not offer Copy on a built-in that uses a built-in-only tool', () => {
        const creator = createMockSkill({
            id: 'creator',
            source: { type: 'builtin', path: '/x/creator' },
            steps: [createMockStep({ id: 'w', tools: ['skiller_writeSkill'] })],
        });
        const out = formatSkillList(fakeRegistry([creator]));
        expect(out.split('\n').find(l => l.includes('`creator`'))).not.toContain('command:skiller.copySkill');
    });
});

describe('formatNewSkillMenu', () => {
    const link = (label: string, kind: string) =>
        `[${label}](command:skiller.newSkill?${encodeURIComponent(JSON.stringify([kind]))} `;

    it('renders one escaped link row in the /skills action style', () => {
        const out = formatNewSkillMenu();
        const row = out.split('\n').find(l => l.startsWith('\\['))!;
        expect(row).toContain(link('✎ Describe it', 'describe'));
        expect(row).toContain(link('▤ From a template', 'template'));
        expect(row).toContain(link('⎘ Copy a skill', 'copy'));
        expect(row.endsWith('\\]')).toBe(true);
        expect(row.split(' | ')).toHaveLength(3);
    });

    it('has a header and a typed-usage hint, and no emoji that means something else', () => {
        const out = formatNewSkillMenu();
        expect(out).toContain('**Create a skill**');
        expect(out).toContain('`@skiller /new ');
        expect(out).not.toContain('📦');
    });
});
