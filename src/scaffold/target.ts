/** Where a new skill is written: the workspace skills folder, else the user folder. Pure: no vscode import. */
import type { SkillRegistry } from '../skills/SkillRegistry';
import type { ScaffoldTarget } from './types';

export function resolveTarget(skillRegistry: SkillRegistry): ScaffoldTarget {
    const ws = skillRegistry.getWorkspaceSkillsPath();
    return ws !== undefined
        ? { root: ws, tier: 'workspace' }
        : { root: skillRegistry.getUserSkillsPath(), tier: 'user' };
}
