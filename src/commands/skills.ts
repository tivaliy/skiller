/**
 * /skills Command
 *
 * Lists all available skills from built-in, user, and workspace sources.
 * When viewing a specific skill, opens a graph visualization in a side panel.
 */

import * as vscode from 'vscode';
import { CommandContext, CommandResult } from './types';
import { showSkillGraph } from '../skills';
import { formatSkillList, formatSkillDetails } from './presenters';

/**
 * Handle /skills command - list available skills
 */
export async function handleSkills(ctx: CommandContext): Promise<CommandResult> {
    const { stream, request, skillRegistry } = ctx;

    // Check if user wants details for a specific skill
    const args = request.prompt.trim();

    if (args) {
        // Show details for specific skill
        return await handleSkillDetails(args, ctx);
    }

    if (skillRegistry.size === 0) {
        stream.markdown('**No skills found.**\n\n');
        stream.markdown('Skills can be added in:\n');
        stream.markdown(`- \`.skiller/skills/\` in your workspace\n`);
        stream.markdown(`- \`${skillRegistry.getUserSkillsPath()}\` for user-level skills\n`);
        stream.markdown('\nSee documentation for creating custom skills.\n');

        return { handled: true, metadata: { command: 'skills', count: 0 } };
    }

    // Format and display skills with trusted markdown for command URIs
    const output = formatSkillList(skillRegistry);
    const md = new vscode.MarkdownString(output);
    md.isTrusted = { enabledCommands: ['workbench.action.chat.open'] };
    stream.markdown(md);

    // Add usage hint
    stream.markdown('\n---\n');
    stream.markdown('**Usage:**\n');
    stream.markdown('- `/skills <name>` - Show skill details\n');
    stream.markdown('- `/skill <name> [params]` - Run a skill\n');

    const discovered = skillRegistry.getDiscoveredSkills();
    return {
        handled: true,
        metadata: {
            command: 'skills',
            count: skillRegistry.size,
            sources: {
                builtin: discovered.builtin.length,
                user: discovered.user.length,
                workspace: discovered.workspace.length
            }
        }
    };
}

/**
 * Show details for a specific skill
 */
async function handleSkillDetails(
    skillId: string,
    ctx: CommandContext
): Promise<CommandResult> {
    const { stream, skillRegistry, extensionUri } = ctx;
    const skill = skillRegistry.getById(skillId);

    if (!skill) {
        stream.markdown(`**Skill not found:** \`${skillId}\`\n\n`);
        stream.markdown('Use `/skills` to see available skills.\n');

        return { handled: true, metadata: { command: 'skills', error: 'not_found' } };
    }

    // Format and display skill details with trusted markdown
    const output = formatSkillDetails(skill);
    const md = new vscode.MarkdownString(output);
    md.isTrusted = { enabledCommands: ['workbench.action.chat.open'] };
    stream.markdown(md);

    // Add clickable Run button (avoid nested brackets to prevent markdown parsing issues)
    stream.markdown('\n---\n');
    const runQuery = `@skiller /skill ${skillId}`;
    const runArgs = encodeURIComponent(JSON.stringify({ query: runQuery }));
    const runLink = `[▶ Run](command:workbench.action.chat.open?${runArgs} "Run ${skillId}")`;
    const runMd = new vscode.MarkdownString(`${runLink}  \`${runQuery}\`\n`);
    runMd.isTrusted = { enabledCommands: ['workbench.action.chat.open'] };
    stream.markdown(runMd);

    // Show required inputs as reference
    const requiredInputs = skill.inputs.filter(i => i.required);
    if (requiredInputs.length > 0) {
        const inputNames = requiredInputs.map(i => `<${i.name}>`).join(' ');
        stream.markdown(`**With params:** \`/skill ${skillId} ${inputNames}\`\n`);
    }

    // Open skill graph in side panel
    if (skill.steps.length > 0) {
        await showSkillGraph(skill, extensionUri, {
            webview: { preserveFocus: true }
        });
        stream.markdown(`\n*Graph opened in side panel*\n`);
    }

    return {
        handled: true,
        metadata: {
            command: 'skills',
            skillId: skill.id,
            action: 'details'
        }
    };
}
