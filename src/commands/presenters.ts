/**
 * Command Presenters
 *
 * Chat-markdown rendering for command output. Kept separate from the data classes
 * (SkillRegistry, ToolCache) so those stay presentation-agnostic and the VS Code
 * chat-markdown / command-link syntax lives in one layer.
 */

import type { Skill, SkillRegistry } from '../skills';
import type { ToolCache } from '../ToolCache';

/** Icon + label for each skill source, keyed by source type (single source of truth). */
const SOURCE_META: Record<Skill['source']['type'], { icon: string; label: string }> = {
    builtin: { icon: '📦', label: 'Built-in' },
    user: { icon: '👤', label: 'User' },
    workspace: { icon: '📁', label: 'Workspace' }
};

/** A tool category with its display name and count. */
export interface ToolCategorySummary {
    category: string;
    displayName: string;
    count: number;
}

/**
 * Summarize tool categories: sorted alphabetically with 'other' last, each with a
 * capitalized display name and its count from the status summary. Shared by the
 * `/tools` table and the tool-status list so the two renderings can't drift.
 * Operates on a copy so the caller's `categories` array isn't mutated.
 */
export function summarizeToolCategories(
    status: ReturnType<ToolCache['getStatus']>
): ToolCategorySummary[] {
    return [...status.categories]
        .sort((a, b) => {
            if (a === 'other') return 1;
            if (b === 'other') return -1;
            return a.localeCompare(b);
        })
        .map(category => ({
            category,
            displayName: category.charAt(0).toUpperCase() + category.slice(1),
            count: status.summary.get(category) || 0
        }));
}

/**
 * Create a markdown link that opens chat with a pre-filled command.
 * Uses VS Code's workbench.action.chat.open command with query parameter.
 */
function formatCommandLink(
    query: string,
    icon: string,
    label: string | null,
    tooltip: string
): string {
    const args = encodeURIComponent(JSON.stringify({ query }));
    const displayText = label ? `${icon} ${label}` : icon;
    return `[${displayText}](command:workbench.action.chat.open?${args} "${tooltip}")`;
}

/**
 * Format action links for a skill: [ ▶ Run | ◉ View ]
 */
function formatSkillActions(skillId: string): string {
    const runLink = formatCommandLink(
        `@skiller /skill ${skillId}`,
        '▶',
        'Run',
        `Run ${skillId}`
    );
    const detailsLink = formatCommandLink(
        `@skiller /skills ${skillId}`,
        '◉',
        'View',
        `View ${skillId} details`
    );
    // Escape the outer brackets so they render as literal decoration.
    // Unescaped `[ ... ]` around the inner command links nests brackets,
    // which VS Code's chat markdown sanitizer mis-parses (it swaps in a
    // placeholder href like https://microsoft.com on the trailing bracket).
    return `\\[ ${runLink} | ${detailsLink} \\]`;
}

/**
 * Format all discovered skills for display in chat.
 */
export function formatSkillList(registry: SkillRegistry): string {
    const discovered = registry.getDiscoveredSkills();
    const lines: string[] = ['**Available Skills:**\n'];
    const bySource = registry.getBySource();

    if (bySource.builtin.length > 0) {
        lines.push('📦 **Built-in:**');
        for (const skill of bySource.builtin) {
            const override = skill.source.overrides ? ' *(overridden)*' : '';
            const actions = formatSkillActions(skill.id);
            lines.push(`  • \`${skill.id}\` ${actions}${override}`);
            lines.push(`    ${skill.description}`);
        }
        lines.push('');
    }

    if (bySource.user.length > 0) {
        lines.push('👤 **User** (`~/.vscode/skiller/skills/`):');
        for (const skill of bySource.user) {
            const override = skill.source.overrides
                ? ` *[overrides ${skill.source.overrides}]*`
                : '';
            const actions = formatSkillActions(skill.id);
            lines.push(`  • \`${skill.id}\` ${actions}${override}`);
            lines.push(`    ${skill.description}`);
        }
        lines.push('');
    }

    if (bySource.workspace.length > 0) {
        lines.push('📁 **Workspace** (`.skiller/skills/`):');
        for (const skill of bySource.workspace) {
            const override = skill.source.overrides
                ? ` *[overrides ${skill.source.overrides}]*`
                : '';
            const actions = formatSkillActions(skill.id);
            lines.push(`  • \`${skill.id}\` ${actions}${override}`);
            lines.push(`    ${skill.description}`);
        }
        lines.push('');
    }

    if (discovered.skills.size === 0 && discovered.parseErrors.length === 0) {
        lines.push('*No skills found.*');
        lines.push('');
        lines.push('Create skills in:');
        lines.push(`  • \`.skiller/skills/\` (workspace)`);
        lines.push(`  • \`~/.vscode/skiller/skills/\` (user)`);
    }

    if (discovered.parseErrors.length > 0) {
        lines.push('');
        lines.push('**⚠️ Failed to load:**');
        for (const error of discovered.parseErrors) {
            lines.push(`  • \`${error.skillId}\` - ${error.error}`);
        }
    }

    return lines.join('\n');
}

/**
 * Format a single skill's details for display.
 */
export function formatSkillDetails(skill: Skill): string {
    const { icon: sourceIcon, label: sourceLabel } = SOURCE_META[skill.source.type];

    // Header with version and source inline
    const lines: string[] = [
        `## ${skill.name}`,
        `*v${skill.version}* · ${sourceIcon} ${sourceLabel}`,
        '',
        skill.description
    ];

    if (skill.source.overrides) {
        lines.push(`*(overrides ${skill.source.overrides})*`);
    }

    // Inputs section
    if (skill.inputs.length > 0) {
        lines.push('');
        lines.push('---');
        lines.push('### Inputs');
        lines.push('');
        for (const input of skill.inputs) {
            const requiredMark = input.required ? ', required' : '';
            const defaultVal = input.default !== undefined
                ? ` · default: \`${JSON.stringify(input.default)}\``
                : '';
            lines.push(`• **\`${input.name}\`** *(${input.type}${requiredMark})*${defaultVal}`);
            if (input.description) {
                lines.push(`  ${input.description}`);
            }
        }
    }

    // Tools section
    const aliasCount = Object.keys(skill.tools.aliases).length;
    if (aliasCount > 0) {
        lines.push('');
        lines.push(`**Tools:** ${aliasCount} alias(es) configured`);
    }

    // Steps as horizontal flow
    if (skill.steps.length > 0) {
        lines.push('');
        lines.push('---');
        lines.push('### Steps');
        lines.push('');
        const stepFlow = skill.steps.map(step => {
            const conditional = step.when ? '*' : '';
            return `\`${step.id}\`${conditional}`;
        }).join(' → ');
        lines.push(stepFlow);

        // Add legend if there are conditional steps
        const hasConditional = skill.steps.some(s => s.when);
        if (hasConditional) {
            lines.push('');
            lines.push('*\\* conditional step*');
        }
    }

    return lines.join('\n');
}

/**
 * Format tool status for display in chat.
 */
export function formatToolStatus(toolCache: ToolCache): string {
    const status = toolCache.getStatus();

    if (!status.available) {
        return `**Tools:** Not configured

Configure MCP servers in \`.vscode/mcp.json\` to enable integrations.`;
    }

    const lines = ['**Tools Available:**'];

    for (const { displayName, count } of summarizeToolCategories(status)) {
        if (count > 0) {
            lines.push(`- ${displayName}: ${count} tools`);
        }
    }

    return lines.join('\n');
}
