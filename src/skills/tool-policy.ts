/**
 * Tool policy: the tools a skill may not simply reference.
 *
 * - BUILTIN_ONLY_TOOLS: Skiller tools reserved for its built-in skills (see reserved-tools.ts).
 * - CHAT_ONLY_TOOLS: tools that need a VS Code chat session (Copilot's agent loop) and
 *   fail when a Skiller run calls them. VS Code exposes no flag for this, so the names
 *   are listed here; extend the list as more are found.
 *
 * Pure: no vscode import.
 */
import type { Skill } from './types';

export const BUILTIN_ONLY_TOOLS: ReadonlySet<string> = new Set(['skiller_writeSkill']);

export const CHAT_ONLY_TOOLS: ReadonlySet<string> = new Set([
    // Copilot's editor-file writers (Skiller ships skiller_createFile / skiller_replaceInFile).
    'copilot_createFile',
    'copilot_editFiles',
    // Subagents and interactive prompts driven by the chat session.
    'search_subagent',
    'explore_subagent',
    'execution_subagent',
    'vscode_askQuestions',
    'vscode_reviewPlan',
]);

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

/** The tools in `policy` among `refs` (alias names or tool names), each once, in first-seen order. */
export function toolsAmong(refs: Iterable<string>, aliases: Record<string, string>, policy: ReadonlySet<string>): string[] {
    const names = new Set([...refs].map((ref) => toolNameOf(ref, aliases)));
    return [...names].filter((name) => policy.has(name));
}

/** The tools in `policy` a skill references in skill.yaml, through aliases or directly in its steps. */
export function toolsUsedBy(skill: Pick<Skill, 'tools' | 'steps'>, policy: ReadonlySet<string>): string[] {
    const { aliases } = skill.tools;
    const refs = [
        ...Object.values(aliases),
        ...skill.steps.flatMap((step) => [...(step.tools ?? []), ...(step.tool ? [step.tool] : [])]),
    ];
    return toolsAmong(refs, aliases, policy);
}

/** The chat-only tools a skill references in skill.yaml. */
export function chatOnlyToolsUsedBy(skill: Pick<Skill, 'tools' | 'steps'>): string[] {
    return toolsUsedBy(skill, CHAT_ONLY_TOOLS);
}

export function chatOnlyToolMessage(name: string): string {
    return `Tool '${name}' only works inside VS Code chat sessions.`;
}
