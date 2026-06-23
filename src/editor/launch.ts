/**
 * Launch helpers
 *
 * Pure logic for launching a skill from the editor: build the chat query,
 * translate the run surface to the chat-open flag, and orchestrate
 * stash-then-open through injected dependencies (so it unit-tests without VS Code).
 */

import type { RunSurface } from '../settings';
import type { EditorContextSnapshot } from '../skills';

/** The chat query that runs a skill via the @skiller participant. */
export function buildSkillQuery(skillId: string): string {
    return `@skiller /skill ${skillId}`;
}

/** chat → submit immediately (isPartialQuery=false); adaptive → prefill & wait (true). */
export function runSurfaceToPartialQuery(surface: RunSurface): boolean {
    return surface !== 'chat';
}

/** Injected side-effects, so launchSkill is testable without VS Code. */
export interface LaunchDeps {
    stashContext(skillId: string, snapshot: EditorContextSnapshot): void;
    getRunSurface(): RunSurface;
    openChat(query: string, isPartialQuery: boolean): Promise<void>;
}

/** Stash the trigger-time snapshot, then open chat with the skill query. */
export async function launchSkill(
    skillId: string,
    snapshot: EditorContextSnapshot,
    deps: LaunchDeps
): Promise<void> {
    deps.stashContext(skillId, snapshot);
    await deps.openChat(buildSkillQuery(skillId), runSurfaceToPartialQuery(deps.getRunSurface()));
}
