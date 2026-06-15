/**
 * Tool Step Runner
 *
 * Executes skill steps that require direct MCP tool invocation.
 * Pure tool invocation - NO LLM involvement.
 *
 * Tool steps require:
 * - tool: the MCP tool name to invoke
 * - params: parameters for the tool (pre-interpolated)
 */

import * as vscode from 'vscode';
import { SkillStep, StepResult } from '../../types';
import type { ProgressHooks } from '../../progress-hooks';
import { getSetting } from '../../../settings';
import {
    findMcpTool,
    extractToolResultData,
    withTimeout,
    isTimeoutError
} from './utils';

/**
 * Injectable dependencies for the tool runner.
 *
 * Defaults wire to VS Code's lm API and the configured timeout; tests inject
 * fakes so the runner can be exercised without the VS Code runtime.
 */
export interface ToolRunnerDeps {
    /** Look up an MCP tool by exact name. */
    findTool: (name: string) => vscode.LanguageModelToolInformation | undefined;
    /** Invoke an MCP tool. */
    invokeTool: (
        name: string,
        options: vscode.LanguageModelToolInvocationOptions<object>,
        token: vscode.CancellationToken
    ) => Thenable<vscode.LanguageModelToolResult>;
    /** Tool-invocation timeout in milliseconds. */
    timeoutMs: number;
}

/**
 * Execute a tool step with direct invocation (no LLM).
 *
 * This is a pure tool call - parameters are provided directly,
 * not extracted by LLM from a prompt.
 *
 * @param step - The skill step definition
 * @param toolName - Resolved MCP tool name to invoke
 * @param params - Pre-interpolated parameters for the tool
 * @param token - Cancellation token
 * @param toolToken - Optional tool invocation token
 * @param stepStart - Timestamp when step started
 * @param hooks - Progress hooks for phase reporting
 * @param deps - Injectable dependencies; any omitted field falls back to the
 *   VS Code-backed implementation (lookup via lm.tools, invoke via lm.invokeTool,
 *   timeout from settings, read per-call so hot-reload applies). The tool-step
 *   handler forwards a resolver-backed `findTool` so its existence decision and
 *   this lookup use a single implementation; tests inject full fakes.
 */
export async function executeToolStep(
    step: SkillStep,
    toolName: string,
    params: Record<string, unknown>,
    token: vscode.CancellationToken,
    toolToken: vscode.ChatParticipantToolToken | undefined,
    stepStart: number,
    hooks: ProgressHooks,
    deps: Partial<ToolRunnerDeps> = {}
): Promise<StepResult> {
    const findTool = deps.findTool ?? findMcpTool;

    // Find the tool
    const tool = findTool(toolName);

    if (!tool) {
        return {
            stepId: step.id,
            success: false,
            error: `Tool not found: ${toolName}`,
            duration: Date.now() - stepStart,
            toolName
        };
    }

    // Resolve invocation deps lazily (only once the tool exists); the timeout is
    // read per-call so settings hot-reload applies.
    const invokeTool = deps.invokeTool ?? ((name, options, tok) => vscode.lm.invokeTool(name, options, tok));
    const timeoutMs = deps.timeoutMs ?? getSetting('skills.toolInvocationTimeout');

    // Invoke the tool with timeout protection
    hooks.onPhaseStart?.(`Calling ${toolName}`);

    try {
        const result = await withTimeout(
            (timeoutToken) => invokeTool(tool.name, {
                input: params,
                toolInvocationToken: toolToken
            }, timeoutToken),
            timeoutMs,
            `Tool invocation: ${toolName}`,
            token
        );

        // Extract data from tool result
        const data = extractToolResultData(result);
        hooks.onPhaseComplete?.(`Called ${toolName}`);

        return {
            stepId: step.id,
            success: true,
            data,
            duration: Date.now() - stepStart,
            toolName
        };

    } catch (error) {
        const errorMessage = isTimeoutError(error)
            ? `Tool invocation timed out after ${error.timeoutMs}ms`
            : `Tool invocation failed: ${error instanceof Error ? error.message : String(error)}`;

        hooks.onPhaseComplete?.(`Failed: ${toolName}`);

        return {
            stepId: step.id,
            success: false,
            error: errorMessage,
            duration: Date.now() - stepStart,
            toolName
        };
    }
}
