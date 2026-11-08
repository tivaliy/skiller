/**
 * Run core: RunController drives one skill run end to end through the engine.
 *
 * Lifecycle of `run`:
 *   single-run lock → definition + readiness checks (warnings shown) → inputs (resolve, ask,
 *   validate) → execute → confirmation loop (ask → resume) → deliver output →
 *   show result → finish.
 *
 * The controller owns the run's cancellation: a dismissed picker (an input or the
 * fallback model), `cancelActive`, a replacing run, or the caller's token all cancel
 * it, and every path ends with `finishExecution` and releases the lock. It talks to the user only through the
 * RunSurface port, and references vscode as types only.
 */

import type { CancellationToken, LanguageModelChat } from 'vscode';
import type { Skill, SkillInput, ExecutionOptions } from '../types';
import type { SkillExecutor } from '../SkillExecutor';
import type { ExecutionStateManager } from '../execution-state';
import type { LaunchContextStore } from '../launch-context-store';
import type { ToolApprovalPolicy } from './tool-approvals';
import { deliverSkillOutput } from '../output/deliver-skill-output';
import { checkReadiness, formatReadinessResult } from '../readiness/factory';
import { validateSkill, formatValidationResult } from '../validators/factory';
import { validateSingleInput, applyDefaults } from '../validators/input-validator';
import { resolveLaunchInputs, inputsToAsk, coerceValue, parseEnumAnswer } from './inputs';
import { resumeAfterChoice } from './confirmation';
import { BUILTIN_ONLY_TOOLS } from '../reserved-tools';
import type { RunSurface, RunRequest, RunOutcome } from './types';

/** A cancellation source; the extension passes `() => new vscode.CancellationTokenSource()`. */
export interface RunCancellation {
    token: CancellationToken;
    cancel(): void;
    dispose(): void;
}

export interface RunControllerDeps {
    executor: SkillExecutor;
    executionState: ExecutionStateManager;
    surface: RunSurface;
    /**
     * The run's fallback model (step and skill models take precedence). `token` is the
     * run's: a picker shown here should close when it fires. Undefined means the user
     * dismissed the picker, which cancels the run.
     */
    resolveModel(skill: Skill, token: CancellationToken): Promise<LanguageModelChat | undefined>;
    launchStore: LaunchContextStore;
    /** Decides when a tool call needs the user's approval. */
    toolApprovals: ToolApprovalPolicy;
    availableMcps(): string[];
    /** Output delivery (injectable for tests). */
    deliver?: typeof deliverSkillOutput;
    newCancellation(): RunCancellation;
}

interface ActiveRun {
    skill: Skill;
    cancel(): void;
    /** Settles once the run has finished and released the lock. */
    done: Promise<void>;
}

const CANCELLED = 'cancelled' as const;

export class RunController {
    private current: ActiveRun | undefined;
    private readonly activeListeners = new Set<() => void>();

    constructor(private readonly deps: RunControllerDeps) {}

    /** The run in progress, if any. */
    get active(): { skill: Skill } | undefined {
        return this.current ? { skill: this.current.skill } : undefined;
    }

    /** Called whenever a run starts or ends (read `active` for the new state). */
    onDidChangeActive(listener: () => void): { dispose(): void } {
        this.activeListeners.add(listener);
        return { dispose: () => { this.activeListeners.delete(listener); } };
    }

    private setCurrent(run: ActiveRun | undefined): void {
        this.current = run;
        for (const listener of [...this.activeListeners]) listener();
    }

    /** Cancel the run in progress. Returns false when nothing is running. */
    cancelActive(): boolean {
        if (!this.current) return false;
        this.current.cancel();
        return true;
    }

    async run(req: RunRequest): Promise<RunOutcome> {
        const previous = this.current;
        if (previous) {
            const replace = await this.deps.surface.confirmReplaceRun(previous.skill, req.skill);
            if (!replace) {
                return { kind: 'notStarted', reason: `'${previous.skill.name}' is still running.` };
            }
            previous.cancel();
            await previous.done;
            // Another request may have taken the slot while we waited.
            if (this.current) {
                return { kind: 'notStarted', reason: `'${this.current.skill.name}' is still running.` };
            }
        }

        const cancellation = this.deps.newCancellation();
        let settled = false;
        let release!: () => void;
        const active: ActiveRun = {
            skill: req.skill,
            cancel: () => { if (!settled) cancellation.cancel(); },
            done: new Promise<void>(resolve => { release = resolve; })
        };
        this.setCurrent(active);

        const callerLink = req.token?.onCancellationRequested(() => active.cancel());
        if (req.token?.isCancellationRequested) active.cancel();

        try {
            return await new RunSession(this.deps, req, cancellation.token).drive();
        } finally {
            settled = true;
            callerLink?.dispose();
            cancellation.dispose();
            if (this.current === active) this.setCurrent(undefined);
            release();
        }
    }
}

/** One run's flow. Owns the execution-state lifecycle so `finishExecution` happens exactly once. */
class RunSession {
    private started = false;
    private finished = false;

    constructor(
        private readonly deps: RunControllerDeps,
        private readonly req: RunRequest,
        private readonly token: CancellationToken
    ) {}

    private get skill(): Skill {
        return this.req.skill;
    }

    async drive(): Promise<RunOutcome> {
        try {
            return await this.flow();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (this.token.isCancellationRequested) return this.cancelled();
            this.deps.surface.showProblems(this.skill, `Skill '${this.skill.name}' failed`, [message]);
            this.finish(false);
            return { kind: 'failed', message };
        }
    }

    private async flow(): Promise<RunOutcome> {
        const { skill } = this;
        const { surface, executionState } = this.deps;

        const problem = await this.checkDefinition();
        if (problem) return problem;
        if (this.token.isCancellationRequested) return this.cancelled();

        // Inputs: explicit → defaults → editor context; then ask for what's still needed.
        const explicit = this.req.inputs ?? {};
        const resolved = await resolveLaunchInputs(skill, applyDefaults(skill, explicit), this.deps.launchStore);
        const toAsk = inputsToAsk(skill, explicit, resolved);

        const invalid = this.invalidProvidedInputs(resolved, toAsk);
        if (invalid.length > 0) {
            surface.showProblems(skill, `Invalid inputs for '${skill.name}'`, invalid);
            return { kind: 'notStarted', reason: invalid.join('\n') };
        }
        if (this.token.isCancellationRequested) return this.cancelled();

        executionState.startExecution(skill.id, skill.steps.map(s => s.id));
        this.started = true;

        const answers = toAsk.length > 0 ? await this.askInputs(toAsk) : {};
        if (answers === CANCELLED) return this.cancelled();
        const inputs = applyDefaults(skill, { ...resolved, ...answers });
        executionState.setTerminalStatus(skill.id, 'start', 'completed');

        // Don't trust the picker to honour the token: stop waiting as soon as the run is cancelled.
        const model = await untilCancelled(this.deps.resolveModel(skill, this.token), this.token);
        if (model === CANCELLED || model === undefined || this.token.isCancellationRequested) return this.cancelled();

        const progress = surface.progress(skill, this.token);
        try {
            const options: ExecutionOptions = {
                inputs,
                model,
                token: this.token,
                hooks: progress,
                availableMcps: this.deps.availableMcps(),
                executionState,
                approveTool: this.deps.toolApprovals.approverFor(async call => {
                    // Built-in-only tools in a built-in run (the skill-creator's write) were
                    // approved with the run and its own confirmation step: no second prompt.
                    // 'once' is not remembered, so nothing is persisted.
                    if (skill.source.type === 'builtin' && BUILTIN_ONLY_TOOLS.has(call.toolName)) return 'once';
                    // A card left open when the run is cancelled must not hold the engine
                    // or let the tool start if the user answers later.
                    const answer = await untilCancelled(surface.approveTool(skill, call), this.token);
                    return answer === CANCELLED ? 'deny' : answer;
                })
            };

            let result = await this.deps.executor.execute(skill, options);
            while (result.pendingConfirmation) {
                const pending = result.pendingConfirmation;
                if (this.token.isCancellationRequested) return this.cancelled(pending.stepId);

                const choice = await untilCancelled(surface.askConfirmation(skill, pending), this.token);
                if (choice === CANCELLED) return this.cancelled(pending.stepId);

                const decision = resumeAfterChoice(skill, pending, choice, result.context, result.steps);
                if (decision.kind === 'abort') return this.cancelled(pending.stepId);
                if (decision.unknownGoto !== undefined) {
                    surface.showWarnings(skill, [`Step "${decision.unknownGoto}" not found. Continuing from the next step.`]);
                }

                result = await this.deps.executor.execute(skill, options, decision.resume);
            }

            if (this.token.isCancellationRequested) return this.cancelled();

            // A failed skill still ends with a result (the caller reads result.success);
            // delivery returns 'none' for it. 'failed' is for errors thrown by the run itself.
            const deliver = this.deps.deliver ?? deliverSkillOutput;
            const delivery = await deliver(skill, result, undefined, this.req.target);
            await surface.showResult(skill, result, delivery);
            this.finish(result.success);
            return { kind: 'completed', result, delivery };
        } finally {
            progress.dispose();
        }
    }

    /** Skill definition and readiness errors stop the run before anything starts. */
    private async checkDefinition(): Promise<RunOutcome | undefined> {
        const { skill } = this;
        const validation = await validateSkill(skill, { validateStepFiles: true });
        if (!validation.valid) {
            this.deps.surface.showProblems(
                skill,
                `Skill '${skill.name}' is invalid`,
                formatValidationResult(skill.id, validation).split('\n')
            );
            return { kind: 'notStarted', reason: validation.errors.map(e => e.message).join('\n') };
        }

        const readiness = checkReadiness(skill, {});
        if (!readiness.canRun) {
            this.deps.surface.showProblems(
                skill,
                `Skill '${skill.name}' can't run`,
                formatReadinessResult(skill.id, readiness).split('\n')
            );
            return { kind: 'notStarted', reason: readiness.errors.map(e => e.message).join('\n') };
        }
        if (readiness.warnings.length > 0) {
            this.deps.surface.showWarnings(
                skill,
                readiness.warnings.map(w => (w.suggestion ? `${w.message} — ${w.suggestion}` : w.message))
            );
        }
        return undefined;
    }

    /** Validation errors for inputs that won't be asked (explicit, context-filled, defaults). */
    private invalidProvidedInputs(resolved: Record<string, unknown>, toAsk: SkillInput[]): string[] {
        const asked = new Set(toAsk.map(i => i.name));
        const errors: string[] = [];
        for (const input of this.skill.inputs) {
            if (asked.has(input.name)) continue;
            const check = validateSingleInput(input, resolved[input.name]);
            if (!check.valid) errors.push(check.error ?? `Invalid value for input '${input.name}'`);
        }
        return errors;
    }

    /** Ask each input in turn, re-asking (after showing the error) until the answer is valid. */
    private async askInputs(toAsk: SkillInput[]): Promise<Record<string, unknown> | typeof CANCELLED> {
        const { skill } = this;
        const { surface, executionState } = this.deps;
        executionState.setTerminalStatus(skill.id, 'start', 'active');

        const answers: Record<string, unknown> = {};
        for (const [index, input] of toAsk.entries()) {
            for (;;) {
                const answer = await untilCancelled(
                    surface.askInput(skill, input, { index, total: toAsk.length }, this.token),
                    this.token
                );
                if (answer === CANCELLED || this.token.isCancellationRequested) return CANCELLED;

                const parsed = parseAnswer(input, answer.value);
                if ('error' in parsed) {
                    surface.showProblems(skill, `Invalid value for '${input.name}'`, [parsed.error]);
                    continue;
                }
                answers[input.name] = parsed.value;
                break;
            }
        }
        return answers;
    }

    /**
     * End a cancelled run (dismissed picker, abort choice, cancelActive, caller token):
     * mark the step the run was waiting on and the end terminal completed, so the
     * graph shows a finished run rather than one stuck waiting.
     */
    private cancelled(waitingStepId?: string): RunOutcome {
        if (this.started && !this.finished) {
            const { executionState } = this.deps;
            if (waitingStepId) executionState.setStepStatus(this.skill.id, waitingStepId, 'completed');
            executionState.setTerminalStatus(this.skill.id, 'end', 'completed');
        }
        this.finish(false);
        return { kind: 'cancelled' };
    }

    private finish(success: boolean): void {
        if (!this.started || this.finished) return;
        this.finished = true;
        this.deps.executionState.finishExecution(this.skill.id, success);
    }
}

/**
 * Turn a raw answer into the input's value, as the chat collector does: an empty
 * answer takes the default (or skips an optional input); enums accept a 1-based
 * number or an exact value; strings are validated raw (the validator understands
 * numeric/boolean strings) and then coerced to the declared type.
 */
function parseAnswer(input: SkillInput, raw: unknown): { value: unknown } | { error: string } {
    const value = typeof raw === 'string' ? raw.trim() : raw;

    if (value === undefined || value === null || value === '') {
        if (input.default !== undefined) return { value: input.default };
        if (input.required) return { error: `Missing required input: ${input.name}` };
        return { value: undefined };
    }

    if (typeof value !== 'string') return checked(input, value);

    if (input.enum && input.enum.length > 0) {
        const parsed = parseEnumAnswer(input, value);
        return 'error' in parsed ? parsed : checked(input, parsed.value);
    }
    // The validator has no string → array rule: split first, then validate the array.
    if (input.type === 'array') return checked(input, coerceValue(value, 'array'));

    const check = validateSingleInput(input, value);
    if (!check.valid) return { error: check.error ?? `Invalid value for input '${input.name}'` };
    return { value: coerceValue(value, input.type) };
}

function checked(input: SkillInput, value: unknown): { value: unknown } | { error: string } {
    const check = validateSingleInput(input, value);
    return check.valid ? { value } : { error: check.error ?? `Invalid value for input '${input.name}'` };
}

/** Wait for `work`, or stop waiting (with 'cancelled') as soon as `token` fires. */
function untilCancelled<T>(work: Promise<T>, token: CancellationToken): Promise<T | typeof CANCELLED> {
    if (token.isCancellationRequested) return Promise.resolve(CANCELLED);
    return new Promise<T | typeof CANCELLED>((resolve, reject) => {
        const subscription = token.onCancellationRequested(() => {
            subscription.dispose();
            resolve(CANCELLED);
        });
        work.then(
            value => { subscription.dispose(); resolve(value); },
            error => { subscription.dispose(); reject(error); }
        );
    });
}
