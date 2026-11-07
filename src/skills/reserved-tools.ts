/**
 * Tools only Skiller's built-in skills may reference. Inside a built-in run they
 * skip the per-call confirmation, so a workspace or user skill (possibly from an
 * untrusted repository) must not reach them. Enforced by:
 * - BuiltinOnlyToolsCheck: an early readiness error for references in skill.yaml.
 * - assertMayUseTools: the runtime gate in the LLM and tool step handlers, which also
 *   covers tools declared in a step file's frontmatter. The same gate refuses
 *   chat-only and not-from-run tools (tool-policy.ts) for every skill, built-ins included.
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
import {
    BUILTIN_ONLY_TOOLS,
    CHAT_ONLY_TOOLS,
    NOT_FROM_RUN_TOOLS,
    chatOnlyToolMessage,
    notFromRunToolMessage,
    toolsAmong,
    toolsUsedBy,
} from './tool-policy';

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

/**
 * Runtime gate: throw if a step is about to offer or call a tool no Skiller run may use
 * (chat-only or not-from-run, for any skill), or a built-in-only tool from a skill that
 * is not built-in. Catches what readiness can't see, such as step-file frontmatter.
 */
export function assertMayUseTools(skill: Pick<Skill, 'source' | 'tools'>, refs: readonly string[]): void {
    const { aliases } = skill.tools;
    const messages = [
        ...toolsAmong(refs, aliases, CHAT_ONLY_TOOLS).map(chatOnlyToolMessage),
        ...toolsAmong(refs, aliases, NOT_FROM_RUN_TOOLS).map(notFromRunToolMessage),
        ...(skill.source.type === 'builtin' ? [] : toolsAmong(refs, aliases, BUILTIN_ONLY_TOOLS).map(builtinOnlyToolMessage)),
    ];
    if (messages.length > 0) {
        throw new Error(messages.join(' '));
    }
}
