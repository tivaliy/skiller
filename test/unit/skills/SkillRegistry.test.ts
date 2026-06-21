/**
 * Tests for SkillRegistry class
 *
 * Tests skill discovery, caching, and the refreshWithDiff functionality.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { SkillRegistry } from '../../../src/skills/SkillRegistry';
import type { Skill, SkillSource, DiscoveredSkills } from '../../../src/skills/types';
import type { ParseError } from '../../../src/skills/parser';

// Mock vscode module
vi.mock('vscode', () => ({
    workspace: {
        fs: {
            stat: vi.fn(),
            readDirectory: vi.fn()
        }
    },
    Uri: {
        file: (path: string) => ({ fsPath: path, path })
    },
    FileType: {
        Directory: 2,
        File: 1,
        SymbolicLink: 64
    }
}));

// Mock the parser module
vi.mock('../../../src/skills/parser', () => ({
    parseSkill: vi.fn()
}));

import * as vscode from 'vscode';
import { parseSkill } from '../../../src/skills/parser';

/**
 * Create a mock skill for testing
 */
function createMockSkill(
    id: string,
    source: SkillSource['type'] = 'builtin',
    overrides?: string
): Skill {
    return {
        id,
        name: `${id} Skill`,
        description: `Description for ${id}`,
        version: '1.0.0',
        inputs: [],
        tools: { aliases: {} },
        steps: [{ id: 'step1', type: 'llm', file: 'steps/01-step.md' }],
        onError: 'abort',
        source: {
            type: source,
            path: `/path/to/${source}/${id}`,
            overrides
        }
    };
}

/**
 * Create a mock parse error
 */
function createMockParseError(skillId: string): ParseError {
    return {
        skillId,
        path: `/path/to/${skillId}`,
        error: `Failed to parse ${skillId}`
    };
}

/**
 * Set up the discovered state on a registry instance
 * Uses Object.defineProperty to set the private field
 */
function setDiscoveredState(
    registry: SkillRegistry,
    skills: Skill[],
    parseErrors: ParseError[] = []
): void {
    const skillMap = new Map<string, Skill>();
    for (const skill of skills) {
        skillMap.set(skill.id, skill);
    }

    const discovered: DiscoveredSkills = {
        skills: skillMap,
        builtin: skills.filter(s => s.source.type === 'builtin'),
        user: skills.filter(s => s.source.type === 'user'),
        workspace: skills.filter(s => s.source.type === 'workspace'),
        overrides: [],
        parseErrors
    };

    // Access private field for testing
    (registry as unknown as { discovered: DiscoveredSkills }).discovered = discovered;
}

/**
 * Create a registry with mocked refresh behavior
 */
function createMockRegistry(
    afterRefreshSkills: Skill[],
    afterRefreshParseErrors: ParseError[] = []
): SkillRegistry {
    const registry = new SkillRegistry('/extension/path', '/workspace/path');

    // Mock the refresh method to set up the "after" state
    vi.spyOn(registry, 'refresh').mockImplementation(async () => {
        setDiscoveredState(registry, afterRefreshSkills, afterRefreshParseErrors);
    });

    return registry;
}

describe('SkillRegistry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('scanSkillsDirectory — directory detection (symlink-aware)', () => {
        // Drive the real scan with mocked fs + parser. FileType is a bitmask, so a
        // symlinked directory reports `Directory | SymbolicLink` (66), not `Directory` (2).
        const scan = (reg: SkillRegistry, dir: string) =>
            (reg as unknown as {
                scanSkillsDirectory(d: string, t: SkillSource['type']): Promise<{ skills: Skill[] }>;
            }).scanSkillsDirectory(dir, 'user');

        it('discovers a skill whose directory entry is a symlink', async () => {
            (vscode.workspace.fs.stat as Mock).mockResolvedValue({ type: vscode.FileType.Directory });
            (vscode.workspace.fs.readDirectory as Mock).mockResolvedValue([
                ['linked-skill', vscode.FileType.Directory | vscode.FileType.SymbolicLink]
            ]);
            (parseSkill as Mock).mockResolvedValue({ success: true, skill: createMockSkill('linked-skill', 'user') });

            const result = await scan(new SkillRegistry('/ext', '/ws'), '/user/skills');
            expect(result.skills.map(s => s.id)).toEqual(['linked-skill']);
        });

        it('scans a skills root that is itself a symlinked directory', async () => {
            (vscode.workspace.fs.stat as Mock).mockResolvedValue({
                type: vscode.FileType.Directory | vscode.FileType.SymbolicLink
            });
            (vscode.workspace.fs.readDirectory as Mock).mockResolvedValue([
                ['plain-skill', vscode.FileType.Directory]
            ]);
            (parseSkill as Mock).mockResolvedValue({ success: true, skill: createMockSkill('plain-skill', 'user') });

            const result = await scan(new SkillRegistry('/ext', '/ws'), '/user/skills');
            expect(result.skills.map(s => s.id)).toEqual(['plain-skill']);
        });

        it('still ignores non-directory entries (bitmask does not over-match)', async () => {
            (vscode.workspace.fs.stat as Mock).mockResolvedValue({ type: vscode.FileType.Directory });
            (vscode.workspace.fs.readDirectory as Mock).mockResolvedValue([
                ['README.md', vscode.FileType.File]
            ]);

            const result = await scan(new SkillRegistry('/ext', '/ws'), '/user/skills');
            expect(result.skills).toEqual([]);
            expect(parseSkill as Mock).not.toHaveBeenCalled();
        });
    });

    describe('refreshWithDiff', () => {
        describe('with no previous state (first refresh)', () => {
            it('treats all discovered skills as added', async () => {
                const skills = [
                    createMockSkill('skill-a', 'builtin'),
                    createMockSkill('skill-b', 'workspace')
                ];
                const registry = createMockRegistry(skills);

                const result = await registry.refreshWithDiff();

                expect(result.beforeCount).toBe(0);
                expect(result.afterCount).toBe(2);
                expect(result.added).toHaveLength(2);
                expect(result.added).toContainEqual({ id: 'skill-a', source: 'builtin' });
                expect(result.added).toContainEqual({ id: 'skill-b', source: 'workspace' });
                expect(result.removed).toHaveLength(0);
            });

            it('reports new parse errors on first refresh', async () => {
                const parseErrors = [createMockParseError('broken-skill')];
                const registry = createMockRegistry([], parseErrors);

                const result = await registry.refreshWithDiff();

                expect(result.newParseErrors).toContain('broken-skill');
                expect(result.parseErrorsFixed).toHaveLength(0);
            });
        });

        describe('with existing state', () => {
            it('detects no changes when skills are unchanged', async () => {
                const skills = [
                    createMockSkill('skill-a', 'builtin'),
                    createMockSkill('skill-b', 'workspace')
                ];
                const registry = createMockRegistry(skills);

                // Set up "before" state (same as after)
                setDiscoveredState(registry, skills);

                const result = await registry.refreshWithDiff();

                expect(result.beforeCount).toBe(2);
                expect(result.afterCount).toBe(2);
                expect(result.added).toHaveLength(0);
                expect(result.removed).toHaveLength(0);
                expect(result.parseErrorsFixed).toHaveLength(0);
                expect(result.newParseErrors).toHaveLength(0);
            });

            it('detects added skills', async () => {
                const beforeSkills = [createMockSkill('skill-a', 'builtin')];
                const afterSkills = [
                    createMockSkill('skill-a', 'builtin'),
                    createMockSkill('skill-b', 'workspace'),
                    createMockSkill('skill-c', 'user')
                ];
                const registry = createMockRegistry(afterSkills);

                // Set up "before" state
                setDiscoveredState(registry, beforeSkills);

                const result = await registry.refreshWithDiff();

                expect(result.beforeCount).toBe(1);
                expect(result.afterCount).toBe(3);
                expect(result.added).toHaveLength(2);
                expect(result.added).toContainEqual({ id: 'skill-b', source: 'workspace' });
                expect(result.added).toContainEqual({ id: 'skill-c', source: 'user' });
                expect(result.removed).toHaveLength(0);
            });

            it('detects removed skills', async () => {
                const beforeSkills = [
                    createMockSkill('skill-a', 'builtin'),
                    createMockSkill('skill-b', 'workspace'),
                    createMockSkill('skill-c', 'user')
                ];
                const afterSkills = [createMockSkill('skill-a', 'builtin')];
                const registry = createMockRegistry(afterSkills);

                // Set up "before" state
                setDiscoveredState(registry, beforeSkills);

                const result = await registry.refreshWithDiff();

                expect(result.beforeCount).toBe(3);
                expect(result.afterCount).toBe(1);
                expect(result.added).toHaveLength(0);
                expect(result.removed).toHaveLength(2);
                expect(result.removed).toContain('skill-b');
                expect(result.removed).toContain('skill-c');
            });

            it('detects both added and removed skills', async () => {
                const beforeSkills = [
                    createMockSkill('skill-a', 'builtin'),
                    createMockSkill('skill-b', 'workspace')
                ];
                const afterSkills = [
                    createMockSkill('skill-a', 'builtin'),
                    createMockSkill('skill-c', 'user')
                ];
                const registry = createMockRegistry(afterSkills);

                // Set up "before" state
                setDiscoveredState(registry, beforeSkills);

                const result = await registry.refreshWithDiff();

                expect(result.beforeCount).toBe(2);
                expect(result.afterCount).toBe(2);
                expect(result.added).toHaveLength(1);
                expect(result.added).toContainEqual({ id: 'skill-c', source: 'user' });
                expect(result.removed).toHaveLength(1);
                expect(result.removed).toContain('skill-b');
            });
        });

        describe('parse error tracking', () => {
            it('detects fixed parse errors', async () => {
                const beforeSkills = [createMockSkill('skill-a', 'builtin')];
                const beforeParseErrors = [createMockParseError('was-broken')];

                const afterSkills = [
                    createMockSkill('skill-a', 'builtin'),
                    createMockSkill('was-broken', 'workspace') // Now parses correctly
                ];
                const registry = createMockRegistry(afterSkills, []);

                // Set up "before" state with parse error
                setDiscoveredState(registry, beforeSkills, beforeParseErrors);

                const result = await registry.refreshWithDiff();

                expect(result.parseErrorsFixed).toContain('was-broken');
                expect(result.newParseErrors).toHaveLength(0);
                expect(result.added).toContainEqual({ id: 'was-broken', source: 'workspace' });
            });

            it('detects new parse errors', async () => {
                const beforeSkills = [
                    createMockSkill('skill-a', 'builtin'),
                    createMockSkill('will-break', 'workspace')
                ];

                const afterSkills = [createMockSkill('skill-a', 'builtin')];
                const afterParseErrors = [createMockParseError('will-break')];
                const registry = createMockRegistry(afterSkills, afterParseErrors);

                // Set up "before" state
                setDiscoveredState(registry, beforeSkills, []);

                const result = await registry.refreshWithDiff();

                expect(result.newParseErrors).toContain('will-break');
                expect(result.parseErrorsFixed).toHaveLength(0);
                expect(result.removed).toContain('will-break');
            });

            it('tracks both fixed and new parse errors', async () => {
                const beforeSkills = [createMockSkill('skill-a', 'builtin')];
                const beforeParseErrors = [createMockParseError('was-broken')];

                const afterSkills = [
                    createMockSkill('skill-a', 'builtin'),
                    createMockSkill('was-broken', 'workspace')
                ];
                const afterParseErrors = [createMockParseError('now-broken')];
                const registry = createMockRegistry(afterSkills, afterParseErrors);

                // Set up "before" state
                setDiscoveredState(registry, beforeSkills, beforeParseErrors);

                const result = await registry.refreshWithDiff();

                expect(result.parseErrorsFixed).toContain('was-broken');
                expect(result.newParseErrors).toContain('now-broken');
            });

            it('does not report unchanged parse errors', async () => {
                const beforeSkills = [createMockSkill('skill-a', 'builtin')];
                const parseErrors = [createMockParseError('still-broken')];

                const afterSkills = [createMockSkill('skill-a', 'builtin')];
                const registry = createMockRegistry(afterSkills, parseErrors);

                // Set up "before" state with same parse error
                setDiscoveredState(registry, beforeSkills, parseErrors);

                const result = await registry.refreshWithDiff();

                expect(result.parseErrorsFixed).toHaveLength(0);
                expect(result.newParseErrors).toHaveLength(0);
            });
        });

        describe('skill source tracking', () => {
            it('correctly identifies source type for added skills', async () => {
                const afterSkills = [
                    createMockSkill('builtin-skill', 'builtin'),
                    createMockSkill('user-skill', 'user'),
                    createMockSkill('workspace-skill', 'workspace')
                ];
                const registry = createMockRegistry(afterSkills);

                const result = await registry.refreshWithDiff();

                expect(result.added).toContainEqual({ id: 'builtin-skill', source: 'builtin' });
                expect(result.added).toContainEqual({ id: 'user-skill', source: 'user' });
                expect(result.added).toContainEqual({ id: 'workspace-skill', source: 'workspace' });
            });
        });

        describe('edge cases', () => {
            it('handles empty before and after states', async () => {
                const registry = createMockRegistry([]);

                const result = await registry.refreshWithDiff();

                expect(result.beforeCount).toBe(0);
                expect(result.afterCount).toBe(0);
                expect(result.added).toHaveLength(0);
                expect(result.removed).toHaveLength(0);
            });

            it('handles all skills being removed', async () => {
                const beforeSkills = [
                    createMockSkill('skill-a', 'builtin'),
                    createMockSkill('skill-b', 'workspace')
                ];
                const registry = createMockRegistry([]);

                setDiscoveredState(registry, beforeSkills);

                const result = await registry.refreshWithDiff();

                expect(result.beforeCount).toBe(2);
                expect(result.afterCount).toBe(0);
                expect(result.removed).toHaveLength(2);
            });

            it('handles skill being replaced (removed and added with same ID)', async () => {
                // This tests the case where a skill is in both before and after
                // It should NOT appear in added or removed
                const skill = createMockSkill('persistent-skill', 'builtin');
                const registry = createMockRegistry([skill]);

                setDiscoveredState(registry, [skill]);

                const result = await registry.refreshWithDiff();

                expect(result.added).toHaveLength(0);
                expect(result.removed).toHaveLength(0);
            });
        });
    });

    describe('getById', () => {
        it('returns undefined when no skills discovered', () => {
            const registry = new SkillRegistry('/extension', '/workspace');

            expect(registry.getById('any-skill')).toBeUndefined();
        });

        it('returns skill by ID when discovered', () => {
            const registry = new SkillRegistry('/extension', '/workspace');
            const skill = createMockSkill('test-skill', 'builtin');
            setDiscoveredState(registry, [skill]);

            const result = registry.getById('test-skill');

            expect(result).toBeDefined();
            expect(result?.id).toBe('test-skill');
        });

        it('returns undefined for non-existent skill ID', () => {
            const registry = new SkillRegistry('/extension', '/workspace');
            const skill = createMockSkill('test-skill', 'builtin');
            setDiscoveredState(registry, [skill]);

            expect(registry.getById('non-existent')).toBeUndefined();
        });
    });

    describe('getAll', () => {
        it('returns empty array when no skills discovered', () => {
            const registry = new SkillRegistry('/extension', '/workspace');

            expect(registry.getAll()).toEqual([]);
        });

        it('returns all discovered skills', () => {
            const registry = new SkillRegistry('/extension', '/workspace');
            const skills = [
                createMockSkill('skill-a', 'builtin'),
                createMockSkill('skill-b', 'workspace')
            ];
            setDiscoveredState(registry, skills);

            const result = registry.getAll();

            expect(result).toHaveLength(2);
            expect(result.map(s => s.id)).toContain('skill-a');
            expect(result.map(s => s.id)).toContain('skill-b');
        });
    });

    describe('has', () => {
        it('returns false when no skills discovered', () => {
            const registry = new SkillRegistry('/extension', '/workspace');

            expect(registry.has('any-skill')).toBe(false);
        });

        it('returns true for existing skill', () => {
            const registry = new SkillRegistry('/extension', '/workspace');
            const skill = createMockSkill('test-skill', 'builtin');
            setDiscoveredState(registry, [skill]);

            expect(registry.has('test-skill')).toBe(true);
        });

        it('returns false for non-existent skill', () => {
            const registry = new SkillRegistry('/extension', '/workspace');
            const skill = createMockSkill('test-skill', 'builtin');
            setDiscoveredState(registry, [skill]);

            expect(registry.has('non-existent')).toBe(false);
        });
    });

    describe('size', () => {
        it('returns 0 when no skills discovered', () => {
            const registry = new SkillRegistry('/extension', '/workspace');

            expect(registry.size).toBe(0);
        });

        it('returns correct count of skills', () => {
            const registry = new SkillRegistry('/extension', '/workspace');
            const skills = [
                createMockSkill('skill-a', 'builtin'),
                createMockSkill('skill-b', 'workspace'),
                createMockSkill('skill-c', 'user')
            ];
            setDiscoveredState(registry, skills);

            expect(registry.size).toBe(3);
        });
    });

    describe('parseErrors', () => {
        it('returns empty array when no parse errors', () => {
            const registry = new SkillRegistry('/extension', '/workspace');
            setDiscoveredState(registry, [], []);

            expect(registry.parseErrors).toEqual([]);
        });

        it('returns parse errors from discovery', () => {
            const registry = new SkillRegistry('/extension', '/workspace');
            const parseErrors = [
                createMockParseError('broken-a'),
                createMockParseError('broken-b')
            ];
            setDiscoveredState(registry, [], parseErrors);

            expect(registry.parseErrors).toHaveLength(2);
            expect(registry.parseErrors.map(e => e.skillId)).toContain('broken-a');
            expect(registry.parseErrors.map(e => e.skillId)).toContain('broken-b');
        });
    });

    describe('getBySource', () => {
        it('returns skills grouped by source', () => {
            const registry = new SkillRegistry('/extension', '/workspace');
            const skills = [
                createMockSkill('builtin-1', 'builtin'),
                createMockSkill('builtin-2', 'builtin'),
                createMockSkill('user-1', 'user'),
                createMockSkill('workspace-1', 'workspace'),
                createMockSkill('workspace-2', 'workspace')
            ];
            setDiscoveredState(registry, skills);

            const result = registry.getBySource();

            expect(result.builtin).toHaveLength(2);
            expect(result.user).toHaveLength(1);
            expect(result.workspace).toHaveLength(2);
        });

        it('returns empty arrays when no skills', () => {
            const registry = new SkillRegistry('/extension', '/workspace');

            const result = registry.getBySource();

            expect(result.builtin).toEqual([]);
            expect(result.user).toEqual([]);
            expect(result.workspace).toEqual([]);
        });
    });
});
