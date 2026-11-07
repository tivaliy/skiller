/**
 * Tools only Skiller's built-in skills may reference. They run without a
 * confirmation prompt, so a workspace or user skill (possibly from an untrusted
 * repository) must not reach them. Enforced in two places:
 * - BuiltinOnlyToolsCheck: an early readiness error for references in skill.yaml.
 * - assertMayUseTools: the runtime gate in the LLM and tool step handlers, which also
 *   covers tools declared in a step file's frontmatter.
 * The `from: tools` list hides them, and built-ins that use them are not offered for
 * copying (a copy could not run).
 *
 * This only governs skills run by Skiller: the tool is still a public
 * `vscode.lm` tool that other extensions can invoke directly.
 * Pure: no vscode import.
 */
import type { Skill } from './types';

export const BUILTIN_ONLY_TOOLS: ReadonlySet<string> = new Set(['skiller_writeSkill']);

/**
 * A tool reference without its optional `?` marker. Same rule as parser's
 * parseAliasValue, restated here because the parser imports vscode.
 */
const bare = (ref: string): string => (ref.endsWith('?') ? ref.slice(0, -1) : ref);

/** The tool a reference resolves to: an alias's target, or the name itself, without `?`. */
function toolNameOf(ref: string, aliases: Record<string, string>): string {
    const name = bare(ref);
    return name in aliases ? bare(aliases[name]) : name;
}

/** The built-in-only tools among `refs` (alias names or tool names). */
function builtinOnlyAmong(refs: Iterable<string>, aliases: Record<string, string>): string[] {
    const names = new Set([...refs].map((ref) => toolNameOf(ref, aliases)));
    return [...names].filter((name) => BUILTIN_ONLY_TOOLS.has(name));
}

/** The built-in-only tools a skill references in skill.yaml, through aliases or directly in its steps. */
export function builtinOnlyToolsUsedBy(skill: Pick<Skill, 'tools' | 'steps'>): string[] {
    const { aliases } = skill.tools;
    const refs = [
        ...Object.values(aliases),
        ...skill.steps.flatMap((step) => [...(step.tools ?? []), ...(step.tool ? [step.tool] : [])]),
    ];
    return builtinOnlyAmong(refs, aliases);
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
    const refused = builtinOnlyAmong(refs, skill.tools.aliases);
    if (refused.length > 0) {
        throw new Error(refused.map(builtinOnlyToolMessage).join(' '));
    }
}
