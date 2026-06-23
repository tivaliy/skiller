/**
 * Finalize Skill Run
 *
 * The shared tail of every successful skill completion in the command layer:
 * deliver the rendered output to its sink, then mark the run finished (graph
 * end-node). Delivery runs BEFORE finishExecution so a delivery failure can't
 * leave the graph showing success with no output — and delivery is a side-channel:
 * its failure is reported but never flips the run's success. Centralized so a new
 * completion side-effect lands in one place (direct, post-input, post-confirm).
 */

import { CommandContext } from '../types';
import type { Skill, SkillResult } from '../../skills';
import { deliverSkillOutput } from '../../skills';
import * as presenter from './presenter';

export async function finalizeSkillRun(
    ctx: CommandContext,
    skill: Skill,
    result: SkillResult
): Promise<void> {
    // The launch target (document + selection captured at trigger) tells editor
    // sinks where to write — consumed once, here at delivery.
    const target = ctx.launchContextStore?.takeTarget(skill.id);
    const outcome = await deliverSkillOutput(skill, result, undefined, target);
    switch (outcome.kind) {
        case 'delivered': presenter.showOutputDelivered(ctx.stream, outcome.sink); break;
        case 'unknownSink': presenter.showUnknownSink(ctx.stream, outcome.to); break;
        case 'failed': presenter.showOutputDeliveryFailed(ctx.stream, outcome.message); break;
        case 'none': break;
    }
    // The engine suppressed the chat echo because this skill routes to a sink, so a
    // failed/unknown delivery would otherwise lose the output entirely. Re-surface
    // the summary in chat as a recovery fallback when nothing was delivered.
    if ((outcome.kind === 'unknownSink' || outcome.kind === 'failed') && result.summary?.trim()) {
        presenter.showOutputFallback(ctx.stream, result.summary);
    }
    ctx.executionState.finishExecution(skill.id, result.success);
}
