/**
 * Run core: confirmation -> resume rules shared by every runner (chat and native).
 *
 * Pure: maps the user's chosen option to where execution resumes and what to
 * record. Presentation and state clearing stay with the caller.
 */

import type {
    Skill,
    PendingConfirmationInfo,
    ConfirmationOption,
    ExecutionContext,
    StepResult,
    ResumeOptions
} from '../types';

export type ConfirmationResume =
    | { kind: 'abort' }
    | {
        kind: 'resume';
        resume: ResumeOptions;
        /** Set when a `goto` named a step that does not exist (fell back to the next step) */
        unknownGoto?: string;
    };

export function resumeAfterChoice(
    skill: Skill,
    pending: PendingConfirmationInfo,
    choice: ConfirmationOption,
    context: ExecutionContext,
    stepResults: StepResult[],
    now: () => number = Date.now
): ConfirmationResume {
    if (choice.action === 'abort') {
        return { kind: 'abort' };
    }

    const step = skill.steps[pending.stepIndex];
    const recordOutput = step?.output
        ? {
            key: step.output,
            value: {
                selectedOption: choice.label,
                selectedIndex: pending.options.indexOf(choice) + 1,
                action: choice.action,
                timestamp: now()
            }
        }
        : undefined;

    let startFromStep = pending.stepIndex + 1;
    let unknownGoto: string | undefined;
    if (choice.action === 'goto' && choice.gotoStep) {
        const gotoIndex = skill.steps.findIndex(s => s.id === choice.gotoStep);
        if (gotoIndex >= 0) {
            startFromStep = gotoIndex;
        } else {
            unknownGoto = choice.gotoStep;
        }
    }

    return {
        kind: 'resume',
        resume: {
            startFromStep,
            existingContext: context,
            existingStepResults: stepResults,
            recordOutput,
            completedStepId: step?.id
        },
        ...(unknownGoto !== undefined ? { unknownGoto } : {})
    };
}
