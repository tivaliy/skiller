/**
 * Tool Step Handler
 *
 * Handles pure tool invocation steps (type: 'tool').
 * Direct MCP tool calls without LLM involvement.
 *
 * Single Responsibility: Execute tool steps with params interpolation.
 *
 * Optional Tools:
 * If a tool step references an optional tool (via ? suffix) that is missing,
 * the step is skipped with a log message instead of failing.
 */

import type { SkillStep, StepType } from '../types';
import type { ProgressHooks } from '../progress-hooks';
import type { StepHandler, StepContext, HandlerResult, HandlerCategory } from './types';
import { ToolResolver, createToolResolver } from '../tool-resolver';
import { interpolateObject } from '../interpolation';
import { executeToolStep } from './runners';
import { buildHandlerResult, createErrorResult, buildSkippedHandlerResult } from './utils';

/**
 * Handler for tool steps (pure MCP tool invocation)
 *
 * Tool steps invoke MCP tools directly without LLM involvement.
 * Parameters are specified via the 'params' field with {{variable}} interpolation.
 *
 * @example
 * ```yaml
 * - id: create_file
 *   type: tool
 *   tool: skiller_createFile
 *   params:
 *     filePath: "{{inputs.filename}}"
 *     content: "{{inputs.content}}"
 * ```
 */
export class ToolStepHandler implements StepHandler {
    readonly category: HandlerCategory = 'execution';
    readonly handledStepTypes: readonly StepType[] = ['tool'];
    readonly usesLLM: boolean = false;

    /**
     * @param toolResolver - Resolver for alias/optionality/existence. Injected for
     *   testability; defaults to the VS Code-backed resolver. Shared with the LLM
     *   handler so tool-reference resolution has a single implementation.
     */
    constructor(private readonly toolResolver: ToolResolver = createToolResolver()) {}

    canHandle(step: SkillStep): boolean {
        return step.type === 'tool';
    }

    async handle(ctx: StepContext, hooks: ProgressHooks): Promise<HandlerResult> {
        const { skill, step, context, token, toolToken } = ctx;
        const stepStart = Date.now();

        try {
            // Resolve alias, optionality, and existence via the shared resolver
            // (no duplicate parsing, no direct vscode.lm access here). Each
            // reference is classified into exactly one of resolved/missing.
            const refs = this.toolResolver.validateReferences([step.tool!], skill.tools.aliases);
            const resolved = refs.resolved[0];
            const missing = refs.missing[0];

            let toolName: string;
            let optional: boolean;
            let exists: boolean;
            if (resolved) {
                ({ toolName, optional } = resolved);
                exists = true;
            } else if (missing) {
                toolName = missing.resolvedName;
                optional = missing.optional;
                exists = false;
            } else {
                // Defensive: validateReferences always classifies the reference.
                throw new Error(`Could not resolve tool reference: ${step.tool}`);
            }

            // If an optional tool is missing, skip the step
            if (!exists && optional) {
                const reason = `Optional tool '${step.tool}' (${toolName}) is not available`;
                hooks.onPromptDisplay?.(`⏭️ Skipping: ${reason}`);
                return buildSkippedHandlerResult(ctx, reason);
            }

            // Interpolate params with context (default to empty object)
            const interpolatedParams = step.params
                ? interpolateObject(step.params, context)
                : {};

            // Display description for debugging
            const description = step.description || `Invoking ${toolName}`;
            hooks.onPromptDisplay?.(description);

            // Execute pure tool call (reports "tool not found" if a required tool is
            // missing). Forward the injected resolver's lookup so the existence
            // decision above and the runner's lookup use one implementation — a
            // fake resolver in tests governs both, instead of the runner falling
            // back to the live vscode.lm API.
            const result = await executeToolStep(
                step,
                toolName,
                interpolatedParams,
                token,
                toolToken,
                stepStart,
                hooks,
                { findTool: name => this.toolResolver.findTool(name) }
            );

            return buildHandlerResult(ctx, result);

        } catch (error) {
            const errorResult = createErrorResult(step.id, error, stepStart);
            return buildHandlerResult(ctx, errorResult);
        }
    }
}
