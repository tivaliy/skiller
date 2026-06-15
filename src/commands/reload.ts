/**
 * /reload Command Handler
 *
 * Reloads MCP tools and skills, displaying what changed.
 */

import { CommandContext, CommandResult } from './types';
import { refreshOpenPanels } from '../skills';

export async function handleReload(ctx: CommandContext): Promise<CommandResult> {
    const { toolCache, skillRegistry, executionState, pendingStateManager, stream } = ctx;

    stream.progress('Reloading tools and skills...');

    // Refresh both in parallel for performance
    const [toolResult, skillResult] = await Promise.all([
        Promise.resolve(toolCache.forceRefreshWithDiff()),
        skillRegistry.refreshWithDiff()
    ]);

    // Reconcile open graph panels with the refreshed registry so /reload doesn't
    // leave orphans or stale views (S-11): edited skills are re-rendered in place,
    // and panels for removed skills are closed.
    await refreshOpenPanels(id => skillRegistry.getById(id));

    // Clear leftover execution highlights and drop any pending interaction that
    // referenced a now-removed skill.
    for (const removedId of skillResult.removed) {
        executionState.reset(removedId);
    }
    if (skillResult.removed.length > 0) {
        const pendingConfId = pendingStateManager.getPendingConfirmation()?.skillId;
        const pendingInputId = pendingStateManager.getPendingInputCollection()?.skillId;
        if (pendingConfId && skillResult.removed.includes(pendingConfId)) {
            pendingStateManager.clearPendingConfirmation();
        }
        if (pendingInputId && skillResult.removed.includes(pendingInputId)) {
            pendingStateManager.clearPendingInputCollection();
        }
    }

    const lines: string[] = ['**Reloaded**\n'];

    // === Tools Section ===
    lines.push('### Tools\n');

    if (toolResult.added.length > 0) {
        lines.push(`**Added (${toolResult.added.length}):**`);
        for (const tool of toolResult.added) {
            lines.push(`  + ${tool}`);
        }
        lines.push('');
    }

    if (toolResult.removed.length > 0) {
        lines.push(`**Removed (${toolResult.removed.length}):**`);
        for (const tool of toolResult.removed) {
            lines.push(`  - ${tool}`);
        }
        lines.push('');
    }

    if (toolResult.added.length === 0 && toolResult.removed.length === 0) {
        lines.push(`No changes. (${toolResult.afterCount} tools)\n`);
    } else {
        lines.push(`**Total:** ${toolResult.afterCount} tools\n`);
    }

    // === Skills Section ===
    lines.push('### Skills\n');

    if (skillResult.added.length > 0) {
        lines.push(`**Added (${skillResult.added.length}):**`);
        for (const { id, source } of skillResult.added) {
            lines.push(`  + ${id} (${source})`);
        }
        lines.push('');
    }

    if (skillResult.removed.length > 0) {
        lines.push(`**Removed (${skillResult.removed.length}):**`);
        for (const id of skillResult.removed) {
            lines.push(`  - ${id}`);
        }
        lines.push('');
    }

    if (skillResult.parseErrorsFixed.length > 0) {
        lines.push(`**Fixed (${skillResult.parseErrorsFixed.length}):**`);
        for (const id of skillResult.parseErrorsFixed) {
            lines.push(`  ✓ ${id}`);
        }
        lines.push('');
    }

    if (skillResult.newParseErrors.length > 0) {
        lines.push(`**⚠️ Parse Errors (${skillResult.newParseErrors.length}):**`);
        for (const id of skillResult.newParseErrors) {
            lines.push(`  ✗ ${id}`);
        }
        lines.push('');
    }

    const noSkillChanges =
        skillResult.added.length === 0 &&
        skillResult.removed.length === 0 &&
        skillResult.parseErrorsFixed.length === 0 &&
        skillResult.newParseErrors.length === 0;

    if (noSkillChanges) {
        lines.push(`No changes. (${skillResult.afterCount} skills)\n`);
    } else {
        lines.push(`**Total:** ${skillResult.afterCount} skills\n`);
    }

    stream.markdown(lines.join('\n'));

    return {
        handled: true,
        metadata: {
            command: 'reload',
            tools: {
                before: toolResult.beforeCount,
                after: toolResult.afterCount,
                added: toolResult.added.length,
                removed: toolResult.removed.length
            },
            skills: {
                before: skillResult.beforeCount,
                after: skillResult.afterCount,
                added: skillResult.added.length,
                removed: skillResult.removed.length,
                parseErrorsFixed: skillResult.parseErrorsFixed.length,
                newParseErrors: skillResult.newParseErrors.length
            }
        }
    };
}
