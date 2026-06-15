/**
 * Control Commands
 *
 * Escape-hatch commands that manage in-flight skill state: /cancel, /reset,
 * /status. Unlike other commands, these are dispatched even while a skill is
 * awaiting input or confirmation (see extension.ts routing) so a user can always
 * recover from a stuck pending interaction without clearing chat history.
 */

import { CommandContext, CommandResult } from './types';

/**
 * /cancel — abort the skill currently awaiting input or confirmation.
 */
export async function handleCancel(ctx: CommandContext): Promise<CommandResult> {
    const { pendingStateManager, executionState, stream } = ctx;

    const skillId =
        pendingStateManager.getPendingConfirmation()?.skillId ??
        pendingStateManager.getPendingInputCollection()?.skillId;

    if (!skillId) {
        stream.markdown('Nothing to cancel — no skill is awaiting input or confirmation.');
        return { handled: true, metadata: { command: 'cancel', nothingPending: true } };
    }

    pendingStateManager.clearAllPendingState();
    executionState.reset(skillId);
    executionState.finishExecution(skillId, false);

    stream.markdown(`🛑 Cancelled \`${skillId}\`.`);
    return { handled: true, metadata: { command: 'cancel', skillId } };
}

/**
 * /reset — clear ALL Skiller state (pending interactions + execution highlights).
 * A blunt recovery hatch when state is wedged.
 */
export async function handleReset(ctx: CommandContext): Promise<CommandResult> {
    const { pendingStateManager, executionState, stream } = ctx;

    const hadPending = pendingStateManager.clearAllPendingState();
    executionState.resetAll();

    stream.markdown(
        hadPending
            ? '♻️ Reset Skiller state and cleared the pending interaction.'
            : '♻️ Reset Skiller state.'
    );
    return { handled: true, metadata: { command: 'reset', hadPending } };
}

/**
 * /status — report whether a skill is awaiting input or confirmation.
 */
export async function handleStatus(ctx: CommandContext): Promise<CommandResult> {
    const { pendingStateManager, stream } = ctx;

    const confirmation = pendingStateManager.getPendingConfirmation();
    const input = pendingStateManager.getPendingInputCollection();

    if (confirmation) {
        const stepId = confirmation.skill.steps[confirmation.pendingStepIndex]?.id ?? '(unknown)';
        stream.markdown(
            `⏸️ \`${confirmation.skillId}\` is awaiting a **confirmation** at step \`${stepId}\`.\n\n` +
            'Reply with an option number, or `/cancel` to abort.'
        );
    } else if (input) {
        stream.markdown(
            `⏸️ \`${input.skillId}\` is awaiting **input**: \`${input.currentInput.name}\`.\n\n` +
            'Provide a value, or `/cancel` to abort.'
        );
    } else {
        stream.markdown('✅ Idle — no skill is running or awaiting input.');
    }

    return {
        handled: true,
        metadata: { command: 'status', pending: Boolean(confirmation || input) }
    };
}
