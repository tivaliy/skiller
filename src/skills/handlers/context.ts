/**
 * Step Context Implementation
 *
 * Immutable context provided to step handlers.
 * Wraps execution state in a read-only interface.
 */

import type * as vscode from 'vscode';
import type {
    Skill,
    SkillStep,
    ExecutionContext,
    StepResult,
    ResolvedModel
} from '../types';
import type { ParsedStep, ToolApprover } from '../types';
import type { StepContext, StepContextFactory } from './types';

/**
 * Immutable step context implementation
 *
 * All properties are readonly - handlers cannot mutate state.
 */
class StepContextImpl implements StepContext {
    readonly skill: Skill;
    readonly step: SkillStep;
    readonly stepIndex: number;
    readonly totalSteps: number;
    readonly parsedStep: ParsedStep | undefined;
    readonly context: ExecutionContext;
    readonly token: vscode.CancellationToken;
    readonly approveTool: ToolApprover | undefined;
    readonly model: vscode.LanguageModelChat;
    readonly resolvedModel: ResolvedModel | undefined;
    readonly startTime: number;
    readonly stepResults: readonly StepResult[];

    constructor(
        skill: Skill,
        step: SkillStep,
        stepIndex: number,
        parsedStep: ParsedStep | undefined,
        context: ExecutionContext,
        options: {
            token: vscode.CancellationToken;
            approveTool?: ToolApprover;
            model: vscode.LanguageModelChat;
            resolvedModel: ResolvedModel | undefined;
        },
        startTime: number,
        stepResults: StepResult[]
    ) {
        this.skill = skill;
        this.step = step;
        this.stepIndex = stepIndex;
        this.totalSteps = skill.steps.length;
        this.parsedStep = parsedStep;
        this.context = context;
        this.token = options.token;
        this.approveTool = options.approveTool;
        this.model = options.model;
        this.resolvedModel = options.resolvedModel;
        this.startTime = startTime;
        // Freeze the array to prevent mutations
        this.stepResults = Object.freeze([...stepResults]);
    }
}

/**
 * Factory for creating step contexts
 */
export const stepContextFactory: StepContextFactory = {
    create(
        skill: Skill,
        step: SkillStep,
        stepIndex: number,
        parsedStep: ParsedStep | undefined,
        context: ExecutionContext,
        options: {
            token: vscode.CancellationToken;
            approveTool?: ToolApprover;
            model: vscode.LanguageModelChat;
            resolvedModel: ResolvedModel | undefined;
        },
        startTime: number,
        stepResults: StepResult[]
    ): StepContext {
        return new StepContextImpl(
            skill,
            step,
            stepIndex,
            parsedStep,
            context,
            options,
            startTime,
            stepResults
        );
    }
};
