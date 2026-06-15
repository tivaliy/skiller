/**
 * Execution Options Factory
 *
 * Builds the ExecutionOptions passed to SkillExecutor.execute() from a command
 * context. Shared by the initial run, post-input-collection run, and confirmation
 * resume so the three paths cannot drift apart.
 */

import { CommandContext } from '../types';
import { getSetting } from '../../settings';
import type { ExecutionOptions } from '../../skills';

/**
 * Build execution options from command context.
 *
 * Reads the current model/stream/token from the live request, so a resumed run
 * intentionally uses the user's current model selection (mid-skill switching).
 */
export function createExecutionOptions(
    ctx: CommandContext,
    inputs: Record<string, unknown>
): ExecutionOptions {
    const { stream, request, token, model, isAutoMode, toolCache, executionState } = ctx;

    return {
        inputs,
        model,
        isAutoMode,
        token,
        stream,
        availableMcps: toolCache.getDiscoveredCategories(),
        toolToken: request.toolInvocationToken,
        verboseMode: getSetting('skills.verboseMode'),
        executionState
    };
}
