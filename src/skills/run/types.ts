/**
 * Run core: the RunSurface port and the run request/outcome types.
 *
 * The RunController drives a run and talks to the user only through a
 * RunSurface, so the same run logic serves any UI (the native editor surface
 * today). vscode appears here as types only.
 */

import type { CancellationToken } from 'vscode';
import type {
    Skill,
    SkillInput,
    SkillResult,
    PendingConfirmationInfo,
    ConfirmationOption
} from '../types';
import type { ProgressHooks } from '../progress-hooks';
import type { DeliveryOutcome, DeliveryTarget } from '../output/types';

/**
 * Everything a run needs from the user and shows to the user.
 *
 * The controller stops waiting on its own when the run is cancelled. `askInput`
 * receives the run's token so a picker can be dismissed on cancel; for the
 * other waiting calls (`askConfirmation`, `approveTool`), which come after
 * `progress`, a surface can watch the token it receives there.
 */
export interface RunSurface {
    /** Ask for one input value. `position` is 0-based within the inputs being asked; `token` is the run's. */
    askInput(
        skill: Skill,
        input: SkillInput,
        position: { index: number; total: number },
        token: CancellationToken
    ): Promise<{ value: unknown } | 'cancelled'>;
    /** Ask which option to take at a confirmation step. Return one of `pending.options` (by reference). */
    askConfirmation(skill: Skill, pending: PendingConfirmationInfo): Promise<ConfirmationOption | 'cancelled'>;
    /** Ask whether a tool call may run. */
    approveTool(skill: Skill, call: ToolCallRequest): Promise<ToolApproval>;
    /** Progress UI for the run; disposed when the run ends. */
    progress(skill: Skill, token: CancellationToken): ProgressHooks & { dispose(): void };
    /** Another run is active: ask whether to cancel it and start `next`. */
    confirmReplaceRun(current: Skill, next: Skill): Promise<boolean>;
    /** Show problems that stopped (or interrupted) a run. */
    showProblems(skill: Skill, title: string, lines: string[]): void;
    /** Show warnings that don't stop the run (readiness warnings, an unknown goto target). */
    showWarnings(skill: Skill, lines: string[]): void;
    /** Present the finished run. Resolve once presented; do not wait on the user. */
    showResult(skill: Skill, result: SkillResult, delivery: DeliveryOutcome): Promise<void>;
}

/** A tool call the engine wants to make. */
export interface ToolCallRequest { toolName: string; input: unknown }

/** The user's answer to a tool call: this call, this run, always in this workspace, or no. */
export type ToolApproval = 'once' | 'run' | 'always' | 'deny';

export interface RunRequest {
    skill: Skill;
    /** Explicit input values; anything missing is resolved from context, defaults, or asked. */
    inputs?: Record<string, unknown>;
    /** Where editor output sinks write; falls back to the target stashed at launch. */
    target?: DeliveryTarget;
    /** Caller's cancellation (e.g. an agent tool call); cancels the run when fired. */
    token?: CancellationToken;
}

export type RunOutcome =
    | { kind: 'completed'; result: SkillResult; delivery: DeliveryOutcome }
    | { kind: 'cancelled' }
    | { kind: 'failed'; message: string }
    | { kind: 'notStarted'; reason: string };
