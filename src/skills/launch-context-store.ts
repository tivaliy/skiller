/**
 * Launch Context Store
 *
 * Session-scoped hand-off of the editor state captured when a skill is launched
 * from the editor (trigger time) to the `/skill` handler — and onward to the
 * output sink — that run a beat later, after chat opens and focus has moved.
 *
 * One slot per skill id, holding two things captured at launch:
 *  - `snapshot` — editor context for resolving `from:` inputs (consumed by `take`),
 *  - `target` — the document + selection for editor output sinks (consumed by `takeTarget`).
 *
 * Entries expire after a TTL so a stash that's never consumed (e.g. the user
 * triggered a skill but never submitted) can't leak into an unrelated later run
 * in a different chat. The TTL is an orphan backstop, NOT a run-duration limit:
 * it is generous (30 min) and is refreshed when a run starts consuming the entry
 * (`take`), so a multi-step skill that pauses on an input or confirmation prompt
 * for a while still finds its delivery target at completion instead of silently
 * falling back to a new document.
 */

import type { EditorContextSnapshot } from './context';
import type { DeliveryTarget } from './output';

interface Entry {
    snapshot?: EditorContextSnapshot;
    target?: DeliveryTarget;
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
        this.upsert(skillId).snapshot = snapshot;
    }

    /** Stash the delivery target (document + selection) captured at trigger time. */
    setTarget(skillId: string, target: DeliveryTarget): void {
        this.upsert(skillId).target = target;
    }

    /** Consume the stashed snapshot for `skillId`, if any and not expired. */
    take(skillId: string): EditorContextSnapshot | undefined {
        const entry = this.fresh(skillId);
        if (!entry) return undefined;
        // Consuming the snapshot means the run has started; refresh the TTL so the
        // still-pending delivery target survives a slow input/confirmation step
        // rather than expiring out from under an in-progress run.
        entry.stashedAt = this.now();
        const snapshot = entry.snapshot;
        entry.snapshot = undefined;
        this.gc(skillId, entry);
        return snapshot;
    }

    /** Consume the stashed delivery target for `skillId`, if any and not expired. */
    takeTarget(skillId: string): DeliveryTarget | undefined {
        const entry = this.fresh(skillId);
        if (!entry) return undefined;
        const target = entry.target;
        entry.target = undefined;
        this.gc(skillId, entry);
        return target;
    }

    /** Whether a (non-expired) delivery target is stashed for `skillId`. */
    hasTarget(skillId: string): boolean {
        return this.fresh(skillId)?.target !== undefined;
    }

    /** Drop all stashed state (e.g. on chat /clear). */
    clear(): void {
        this.pending.clear();
    }

    private upsert(skillId: string): Entry {
        let entry = this.pending.get(skillId);
        if (!entry) {
            entry = { stashedAt: this.now() };
            this.pending.set(skillId, entry);
        } else {
            entry.stashedAt = this.now(); // refresh the TTL on re-stash
        }
        return entry;
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

    private gc(skillId: string, entry: Entry): void {
        if (entry.snapshot === undefined && entry.target === undefined) {
            this.pending.delete(skillId);
        }
    }
}
