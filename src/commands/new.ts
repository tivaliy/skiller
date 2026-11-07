/**
 * /new Command Handler
 *
 * Entry point for creating a skill from chat. With no text it offers the three
 * creation paths as a link row (same style as the /skills actions); with text
 * it hands the whole prompt to the skill-creator skill as its `idea`.
 */

import * as vscode from 'vscode';
import { CommandContext, CommandResult } from './types';
import { formatNewSkillMenu, NEW_SKILL_COMMAND } from './presenters';
import { runSkillById } from './skill/handler';

const SKILL_CREATOR_ID = 'skill-creator';

export async function handleNew(ctx: CommandContext): Promise<CommandResult> {
    const idea = ctx.request.prompt.trim();

    if (!idea) {
        const md = new vscode.MarkdownString(formatNewSkillMenu());
        md.isTrusted = { enabledCommands: [NEW_SKILL_COMMAND] };
        ctx.stream.markdown(md);
        return { handled: true, metadata: { command: 'new' } };
    }

    return runSkillById(ctx, SKILL_CREATOR_ID, { idea });
}
