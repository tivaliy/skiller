/**
 * Launch Context Store
 *
 * Session-scoped hand-off of the editor snapshot captured when a skill is launched
 * from the editor (trigger time) to the RunController, which resolves `from:` inputs
 * from it a beat later, after the launch has moved focus. One slot per skill id,
 * consumed by `take`. (The delivery target for editor output sinks travels with the
 * RunRequest instead, so a second launch can't redirect a run in progress.)
 *
 * Entries expire after a TTL so a stash that's never consumed (e.g. the user
 * triggered a skill but never ran it) can't leak into an unrelated later run.
 * The TTL is an orphan backstop, not a run-duration limit.
 */

import type { EditorContextSnapshot } from './context';

interface Entry {
    snapshot: EditorContextSnapshot;
    stashedAt: number;
}

export class LaunchContextStore {
    private pending = new Map<string, Entry>();

    constructor(
        private readonly ttlMs = 30 * 60_000,
        private readonly now: () => number = () => Date.now()
    ) {}

    /** Stash the editor snapshot captured at trigger time for `skillId`. */
    set(skillId: string, snapshot: EditorContextSnapshot): void {
        this.pending.set(skillId, { snapshot, stashedAt: this.now() });
    }

    /** Consume the stashed snapshot for `skillId`, if any and not expired. */
    take(skillId: string): EditorContextSnapshot | undefined {
        const entry = this.fresh(skillId);
        this.pending.delete(skillId);
        return entry?.snapshot;
    }

    /** Drop all stashed state. */
    clear(): void {
        this.pending.clear();
    }

    private fresh(skillId: string): Entry | undefined {
        const entry = this.pending.get(skillId);
        if (!entry) return undefined;
        if (this.now() - entry.stashedAt > this.ttlMs) {
            this.pending.delete(skillId);
            return undefined;
        }
        return entry;
    }
}
