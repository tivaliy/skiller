/**
 * Tools only Skiller's built-in skills may reference. Inside a built-in run they
 * skip the per-call confirmation, so a workspace or user skill (possibly from an
 * untrusted repository) must not reach them. Enforced by:
 * - BuiltinOnlyToolsCheck: an early readiness error for references in skill.yaml.
 * - assertMayUseTools: the runtime gate in the LLM and tool step handlers, which also
 *   covers tools declared in a step file's frontmatter.
 * - The native ToolApprovalPolicy wiring (RunController), which skips the prompt only
 *   for a built-in skill's call.
 * - skiller_writeSkill's own origin check, which confirms writes that don't come
 *   from the skill-creator.
 * The `from: tools` list hides them, and built-ins that use them are not offered for
 * copying (a copy could not run).
 *
 * This only governs skills run by Skiller: the tool is still a public
 * `vscode.lm` tool that other extensions can invoke directly.
 * Pure: no vscode import.
 */
import type { Skill } from './types';
import { BUILTIN_ONLY_TOOLS, toolsAmong, toolsUsedBy } from './tool-policy';

export { BUILTIN_ONLY_TOOLS };

/** The built-in-only tools a skill references in skill.yaml, through aliases or directly in its steps. */
export function builtinOnlyToolsUsedBy(skill: Pick<Skill, 'tools' | 'steps'>): string[] {
    return toolsUsedBy(skill, BUILTIN_ONLY_TOOLS);
}

/** A built-in skill offered for copying: one that does not depend on a built-in-only tool. */
export function isCopyableBuiltin(skill: Pick<Skill, 'source' | 'tools' | 'steps'>): boolean {
    return skill.source.type === 'builtin' && builtinOnlyToolsUsedBy(skill).length === 0;
}

export function builtinOnlyToolMessage(name: string): string {
    return `Tool '${name}' can only be used by Skiller's built-in skills.`;
}

/** Runtime gate: throw if a non-built-in skill is about to offer or call a built-in-only tool. */
export function assertMayUseTools(skill: Pick<Skill, 'source' | 'tools'>, refs: readonly string[]): void {
    if (skill.source.type === 'builtin') {
        return;
    }
    const refused = toolsAmong(refs, skill.tools.aliases, BUILTIN_ONLY_TOOLS);
    if (refused.length > 0) {
        throw new Error(refused.map(builtinOnlyToolMessage).join(' '));
    }
}
