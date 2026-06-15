/**
 * LLM Step Handler
 *
 * Handles LLM reasoning steps (type: 'llm').
 * Agentic pattern with optional tool use.
 *
 * Single Responsibility: Execute LLM steps with prompt interpolation and tool resolution.
 */

import * as vscode from 'vscode';
import type { Skill, SkillStep, StepType, ParsedStep, ExecutionContext } from '../types';
import type { ProgressHooks } from '../progress-hooks';
import type { StepHandler, StepContext, HandlerResult, HandlerCategory } from './types';
import type { ToolResolver } from '../tool-resolver';
import { interpolate } from '../interpolation';
import { executeLLMStep } from './runners';
import { buildHandlerResult, createErrorResult } from './utils';

/**
 * Handler for LLM steps (agentic reasoning with optional tool use)
 *
 * LLM steps use AI reasoning to process prompts and optionally call tools.
 * Prompts can be provided via file (step.file) or inline (step.message).
 *
 * @example
 * ```yaml
 * # File-based prompt
 * - id: analyze_code
 *   type: llm
 *   file: steps/analyze.md
 *   tools: [example_readFile, example_searchCode]
 *
 * # Inline prompt
 * - id: quick_analysis
 *   type: llm
 *   message: "Analyze this: {{ inputs.data }}"
 * ```
 */
export class LLMStepHandler implements StepHandler {
    readonly category: HandlerCategory = 'execution';
    readonly handledStepTypes: readonly StepType[] = ['llm'];
    readonly usesLLM: boolean = true;

    constructor(private readonly toolResolver?: ToolResolver) {}

    canHandle(step: SkillStep): boolean {
        // Handle LLM steps only (type is now required)
        return step.type === 'llm';
    }

    async handle(ctx: StepContext, hooks: ProgressHooks): Promise<HandlerResult> {
        const { step, parsedStep, context } = ctx;

        // Resolve prompt from file or inline message
        const prompt = this.resolvePrompt(step, parsedStep, context);

        // LLM steps require either file or message
        if (!prompt) {
            const stepStart = Date.now();
            return buildHandlerResult(ctx, createErrorResult(
                step.id,
                new Error(`LLM step '${step.id}' has no prompt (neither file nor message provided)`),
                stepStart
            ));
        }

        // Execute LLM step with resolved prompt
        // Note: modelUsed is added by executor (for handlers with usesLLM: true)
        const stepResult = await this.executeLLMStepWithPrompt(ctx, prompt, parsedStep, hooks);

        return buildHandlerResult(ctx, stepResult);
    }

    /**
     * Resolve LLM prompt from file or inline message
     *
     * Priority:
     * 1. File content (parsedStep.prompt) - takes precedence
     * 2. Inline message (step.message) - fallback
     *
     * @returns Interpolated prompt string, or undefined if neither source available
     */
    private resolvePrompt(
        step: SkillStep,
        parsedStep: ParsedStep | undefined,
        context: ExecutionContext
    ): string | undefined {
        if (parsedStep?.prompt) {
            return interpolate(parsedStep.prompt, context);
        }
        if (step.message) {
            return interpolate(step.message, context);
        }
        return undefined;
    }

    /**
     * Execute the LLM step with pre-resolved prompt
     */
    private async executeLLMStepWithPrompt(
        ctx: StepContext,
        prompt: string,
        parsedStep: ParsedStep | undefined,
        hooks: ProgressHooks
    ) {
        const { skill, step, resolvedModel, token, toolToken } = ctx;

        // LLM steps always have a resolved model (executor ensures this)
        if (!resolvedModel) {
            throw new Error(`LLM step ${step.id} missing resolved model`);
        }

        const stepStart = Date.now();

        try {
            // Display prompt via hook
            hooks.onPromptDisplay?.(prompt);

            // Resolve tools for LLM step (agentic tool use)
            // Note: parsedStep may be undefined for inline message steps
            const stepTools = this.resolveStepTools(step, parsedStep, skill);
            const toolMode = this.determineToolMode(step, parsedStep, stepTools);

            // Execute LLM step using resolved model
            // This may differ from ctx.model if skill has model config
            return await executeLLMStep(
                step,
                prompt,
                resolvedModel.model,  // Use resolved model, not request model
                token,
                toolToken,
                stepStart,
                stepTools,
                toolMode,
                hooks
            );

        } catch (error) {
            return createErrorResult(step.id, error, stepStart);
        }
    }

    /**
     * Resolve available tools for an LLM step
     *
     * Uses injected ToolResolver if available, otherwise falls back to direct lookup.
     * Note: parsedStep may be undefined for inline message steps.
     */
    private resolveStepTools(
        step: SkillStep,
        parsedStep: ParsedStep | undefined,
        skill: Skill
    ): vscode.LanguageModelToolInformation[] {
        const toolNames = step.tools || parsedStep?.meta.tools || [];

        if (toolNames.length === 0) {
            return [];
        }

        // Use injected resolver if available
        if (this.toolResolver) {
            return this.toolResolver.resolve(toolNames, skill.tools.aliases);
        }

        // Fallback to direct lookup
        const tools: vscode.LanguageModelToolInformation[] = [];

        for (const rawName of toolNames) {
            const resolvedName = skill.tools.aliases[rawName] || rawName;
            const tool = vscode.lm.tools.find(t => t.name === resolvedName);
            if (tool) {
                tools.push(tool);
            }
        }

        return tools;
    }

    /**
     * Determine tool mode for LLM step
     * Note: parsedStep may be undefined for inline message steps.
     */
    private determineToolMode(
        step: SkillStep,
        parsedStep: ParsedStep | undefined,
        tools: vscode.LanguageModelToolInformation[]
    ): 'auto' | 'required' {
        // Explicit mode takes precedence
        if (step.toolMode) return step.toolMode;
        if (parsedStep?.meta.toolMode) return parsedStep.meta.toolMode;

        // Default: 'required' for single tool, 'auto' for multiple
        return tools.length === 1 ? 'required' : 'auto';
    }
}
