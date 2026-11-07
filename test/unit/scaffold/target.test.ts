import { describe, expect, it } from 'vitest';
import { resolveTarget } from '../../../src/scaffold/target';
import type { SkillRegistry } from '../../../src/skills/SkillRegistry';

const stub = (ws: string | undefined) =>
    ({ getWorkspaceSkillsPath: () => ws, getUserSkillsPath: () => '/home/u/.skiller/skills' }) as unknown as SkillRegistry;

describe('resolveTarget', () => {
    it('uses the workspace path when defined', () => {
        expect(resolveTarget(stub('/ws/.skiller/skills'))).toEqual({ root: '/ws/.skiller/skills', tier: 'workspace' });
    });
    it('falls back to the user path', () => {
        expect(resolveTarget(stub(undefined))).toEqual({ root: '/home/u/.skiller/skills', tier: 'user' });
    });
});
