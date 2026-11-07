/**
 * Deliver Skill Output
 *
 * Command-layer entry: after a skill completes, route its rendered
 * `output.summary` to the configured `output.to` sink. Returns a DeliveryOutcome
 * so the caller can report success/failure WITHOUT flipping the run's status —
 * delivery is a side-channel. Returns `{ kind: 'none' }` when the run failed,
 * there's no `to` (chat-only, the existing behavior), or there's nothing to deliver.
 */

import type { Skill, SkillResult } from '../types';
import type { OutputDeps, DeliveryOutcome, DeliveryTarget } from './types';
import { parseSink, deliverOutput } from './sinks';
import { createVsCodeOutputDeps } from './accessors';
import { interpolate } from '../interpolation';
import { stripCodeFence } from '../utils';

export { stripCodeFence };

export async function deliverSkillOutput(
    skill: Skill,
    result: SkillResult,
    deps: OutputDeps = createVsCodeOutputDeps(),
    target?: DeliveryTarget
): Promise<DeliveryOutcome> {
    if (!result.success) return { kind: 'none' }; // never deliver for a failed run
    const to = skill.output?.to;
    if (!to) return { kind: 'none' }; // chat-only (existing behavior)

    // Interpolate the target so paths can be templated (e.g. file:out/{{ inputs.name }}.md).
    // Non-strict: an undefined variable degrades to empty rather than throwing on a run that
    // already completed — a strict throw here surfaces as a misleading post-success failure.
    const resolvedTo = interpolate(to, result.context, { strictVariables: false });
    const sink = parseSink(resolvedTo);
    if (!sink) return { kind: 'unknownSink', to: resolvedTo };

    // Strip a wrapping code fence (LLM steps routinely wrap code in ```lang despite prompting)
    // and never write empty content into a destructive sink (would delete a selection / truncate a file).
    const content = stripCodeFence(result.summary ?? '');
    if (content.trim() === '') return { kind: 'none' };

    try {
        const where = await deliverOutput(content, sink, deps, target);
        return where === 'newDocument' ? { kind: 'delivered', sink, fellBack: true } : { kind: 'delivered', sink };
    } catch (error) {
        return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
}
