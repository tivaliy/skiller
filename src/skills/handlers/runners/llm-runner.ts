/**
 * LLM Step Runner
 *
 * Executes skill steps using the language model, with optional tool use.
 * Handles the agentic loop of LLM → tool calls → LLM analysis.
 */

import * as vscode from 'vscode';
import { SkillStep, StepResult, ToolMode } from '../../types';
import type { ProgressHooks } from '../../progress-hooks';
import { tryParseJson, withTimeout, isTimeoutError } from './utils';
import { getSetting } from '../../../settings';

/**
 * Known error patterns in MCP tool results.
 *
 * Intentionally narrow: these match Skiller's own framed invocation failures
 * (see the catch block below) and clear tool-execution failures — NOT a bare
 * "Error: ..." prefix, which legitimately appears in valid tool output (e.g.
 * "Error: 0 results") and previously caused false-positive step failures (S-16).
 */
const TOOL_ERROR_PATTERNS = [
    /^Error calling tool\s/i,
    /^Failed to invoke/i,
    /^Tool execution (failed|error)/i
];

/**
 * Check if a tool result indicates an error
 */
function isToolResultError(resultText: string): boolean {
    return TOOL_ERROR_PATTERNS.some(pattern => pattern.test(resultText));
}

/**
 * Truncate the text content of a tool result so the WHOLE result stays within
 * `maxLen` characters (summed across its text parts), not each part individually
 * — a result split into many sub-`maxLen` parts would otherwise escape the cap.
 *
 * Large tool payloads (e.g. "list 100 issues") are otherwise resent verbatim on
 * every subsequent iteration, blowing up token usage and risking context-window
 * overflow. Non-text parts are passed through unchanged. A non-positive `maxLen`
 * disables truncation, so a misconfigured `0` can't silently empty all output.
 * See `skiller.llm.maxToolResponseLength`.
 */
export function truncateResultContent<T>(content: readonly T[] | undefined, maxLen: number): T[] {
    if (!content) return [];
    if (maxLen <= 0) return [...content];

    let remaining = maxLen;
    let omitted = 0;
    const out: T[] = [];
    for (const part of content) {
        if (!(part instanceof vscode.LanguageModelTextPart)) {
            out.push(part);
            continue;
        }
        if (remaining <= 0) {
            // Budget already spent by earlier parts — drop this text entirely.
            omitted += part.value.length;
        } else if (part.value.length > remaining) {
            out.push(new vscode.LanguageModelTextPart(part.value.slice(0, remaining)) as unknown as T);
            omitted += part.value.length - remaining;
            remaining = 0;
        } else {
            out.push(part);
            remaining -= part.value.length;
        }
    }
    if (omitted > 0) {
        out.push(new vscode.LanguageModelTextPart(`\n…[truncated ${omitted} chars]`) as unknown as T);
    }
    return out;
}

/**
 * Does this message carry a tool result (and would be orphaned without its
 * preceding assistant tool-call message)?
 */
function isToolResultMessage(message: vscode.LanguageModelChatMessage): boolean {
    const content = message.content as unknown;
    return Array.isArray(content) &&
        content.some(p => p instanceof vscode.LanguageModelToolResultPart);
}

/**
 * Bound the running message history before each request to cap token usage,
 * while preserving tool-call/tool-result pairing.
 *
 * - The first message (the task prompt) is always kept.
 * - The retained tail is capped by `maxTurns` and by `maxToolResponses`.
 * - The tail never begins on an orphaned tool-result (whose assistant tool-call
 *   would have been dropped), which the model would reject.
 *
 * See `skiller.llm.maxHistoryTurns` and `skiller.llm.maxToolResponses`.
 */
export function trimMessageHistory(
    messages: vscode.LanguageModelChatMessage[],
    maxTurns: number,
    maxToolResponses: number
): vscode.LanguageModelChatMessage[] {
    if (messages.length <= 1) return messages;

    const turnCap = Math.max(1, maxTurns);          // the prompt always counts as one turn
    const responseCap = Math.max(0, maxToolResponses);

    const first = messages[0];
    const rest = messages.slice(1);

    // Single backward pass: extend the retained tail from the newest message
    // until adding the next (older) message would exceed the turn cap or the
    // tool-response budget.
    let start = rest.length;
    let kept = 0;
    let toolResults = 0;
    for (let i = rest.length - 1; i >= 0; i--) {
        if (kept >= turnCap - 1) break;
        const isToolResult = isToolResultMessage(rest[i]);
        if (isToolResult && toolResults >= responseCap) break;
        kept++;
        if (isToolResult) toolResults++;
        start = i;
    }

    // Never start the retained tail on an orphaned tool-result (whose preceding
    // assistant tool-call message was dropped), which the model would reject.
    while (start < rest.length && isToolResultMessage(rest[start])) start++;

    if (start <= 0) return messages;
    return [first, ...rest.slice(start)];
}

/**
 * Settings consumed by the LLM runner (iteration cap, timeout, token-runaway guards).
 */
export interface LLMRunnerSettings {
    maxToolIterations: number;
    toolInvocationTimeout: number;
    maxHistoryTurns: number;
    maxToolResponseLength: number;
    maxToolResponses: number;
}

/**
 * Injectable dependencies for the LLM runner.
 *
 * Defaults wire to VS Code's lm API and the configured settings; tests inject
 * fakes so the agentic loop can be exercised without the VS Code runtime.
 * (The model itself is already passed in as a parameter.)
 */
export interface LLMRunnerDeps {
    invokeTool: (
        name: string,
        options: vscode.LanguageModelToolInvocationOptions<object>,
        token: vscode.CancellationToken
    ) => Thenable<vscode.LanguageModelToolResult>;
    settings: LLMRunnerSettings;
}

/**
 * Production defaults. Settings are read per-call so hot-reload applies.
 */
function defaultLLMRunnerDeps(): LLMRunnerDeps {
    return {
        invokeTool: (name, options, token) => vscode.lm.invokeTool(name, options, token),
        settings: {
            maxToolIterations: getSetting('skills.maxToolIterations'),
            toolInvocationTimeout: getSetting('skills.toolInvocationTimeout'),
            maxHistoryTurns: getSetting('llm.maxHistoryTurns'),
            maxToolResponseLength: getSetting('llm.maxToolResponseLength'),
            maxToolResponses: getSetting('llm.maxToolResponses')
        }
    };
}

/**
 * Execute an LLM step with optional tool use.
 *
 * Uses ProgressHooks for phase reporting - no direct UI dependency.
 *
 * @param step - The skill step definition
 * @param prompt - Interpolated prompt with context
 * @param model - VS Code language model
 * @param token - Cancellation token
 * @param toolToken - Optional tool invocation token
 * @param stepStart - Timestamp when step started
 * @param tools - Available MCP tools for this step
 * @param toolMode - 'required' forces tool use, 'auto' lets LLM decide
 * @param hooks - Progress hooks for phase reporting
 */
export async function executeLLMStep(
    step: SkillStep,
    prompt: string,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    toolToken: vscode.ChatParticipantToolToken | undefined,
    stepStart: number,
    tools: vscode.LanguageModelToolInformation[] = [],
    toolMode: ToolMode = 'auto',
    hooks: ProgressHooks,
    deps: LLMRunnerDeps = defaultLLMRunnerDeps()
): Promise<StepResult> {
    let messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(prompt)
    ];

    const toolsInvoked: string[] = [];
    const toolErrors: string[] = []; // Track tool errors for failure detection
    const {
        maxToolIterations,
        toolInvocationTimeout,
        // Token-runaway guards (applied to the running tool-use history).
        maxHistoryTurns,
        maxToolResponseLength,
        maxToolResponses
    } = deps.settings;
    let iterations = 0;

    // Show initial phase - waiting for LLM or tool decision
    if (tools.length > 0) {
        hooks.onPhaseStart?.('Analyzing request');
    } else {
        hooks.onPhaseStart?.('Processing');
    }

    // Track whether streaming is active for proper cleanup
    let streamingActive = false;

    try {
        while (iterations < maxToolIterations) {
            iterations++;

            // Send request with tools if available
            const requestOptions: vscode.LanguageModelChatRequestOptions = {};
            if (tools.length > 0) {
                requestOptions.tools = tools;
                // Set toolMode to 'required' ONLY on the first iteration (so the tool
                // gets called, then 'auto' lets the LLM analyze results — preventing
                // infinite loops), and ONLY for a single tool. Several models reject
                // 'required' mode with more than one tool (see SkillStep.toolMode note),
                // so multi-tool steps fall back to 'auto' instead of erroring (S-22).
                if (toolMode === 'required' && iterations === 1 && tools.length === 1) {
                    requestOptions.toolMode = vscode.LanguageModelChatToolMode.Required;
                }
            }

            // Bound history before sending to cap token usage (preserves pairing).
            messages = trimMessageHistory(messages, maxHistoryTurns, maxToolResponses);

            const response = await model.sendRequest(messages, requestOptions, token);

            let resultText = '';
            let isFirstChunk = true;
            const toolCalls: Array<{
                callId: string;
                name: string;
                input: Record<string, unknown>;
            }> = [];

            // Process response - handle both text and tool calls
            try {
                for await (const part of response.stream) {
                    if (token.isCancellationRequested) {
                        throw new Error('Cancelled');
                    }

                    if (part instanceof vscode.LanguageModelTextPart) {
                        resultText += part.value;
                        // Stream chunk to UI (verbose mode handles visibility)
                        hooks.onStreamChunk?.(part.value, isFirstChunk);
                        if (isFirstChunk) {
                            streamingActive = true;
                            isFirstChunk = false;
                        }
                    } else if (part instanceof vscode.LanguageModelToolCallPart) {
                        toolCalls.push({
                            callId: part.callId,
                            name: part.name,
                            input: part.input as Record<string, unknown>
                        });
                    }
                }
            } finally {
                // Always signal end of streaming to prevent UI stuck in streaming state
                if (streamingActive) {
                    hooks.onStreamEnd?.();
                    streamingActive = false;
                }
            }

            // If no tool calls, we're done
            if (toolCalls.length === 0) {
                hooks.onPhaseComplete?.(iterations === 1 ? 'Processed' : 'Analyzed results');
                const data = tryParseJson(resultText) || resultText;

                // If any tool errors occurred, fail the step
                // This ensures tool failures don't silently continue execution
                if (toolErrors.length > 0) {
                    return {
                        stepId: step.id,
                        success: false,
                        error: `Tool execution failed: ${toolErrors.join('; ')}`,
                        data, // Include data for debugging
                        duration: Date.now() - stepStart,
                        prompt,
                        toolsUsed: toolsInvoked.length > 0 ? toolsInvoked : undefined
                    };
                }

                return {
                    stepId: step.id,
                    success: true,
                    data,
                    duration: Date.now() - stepStart,
                    prompt,
                    toolsUsed: toolsInvoked.length > 0 ? toolsInvoked : undefined
                };
            }

            // Mark initial analysis complete
            if (iterations === 1) {
                hooks.onPhaseComplete?.('Analyzed request');
            }

            // Execute tool calls and add results to messages
            const assistantMessage = vscode.LanguageModelChatMessage.Assistant('');
            // Add tool calls to assistant message
            for (const call of toolCalls) {
                (assistantMessage.content as unknown[]).push(
                    new vscode.LanguageModelToolCallPart(call.callId, call.name, call.input)
                );
            }
            messages.push(assistantMessage);

            // Execute each tool and collect results
            for (const call of toolCalls) {
                hooks.onPhaseStart?.(`Calling ${call.name}`);
                toolsInvoked.push(call.name);

                try {
                    // Wrap tool invocation in timeout (configurable via settings).
                    // The timeout token aborts the invocation if it elapses; the step
                    // token is the parent so user cancellation still propagates.
                    const toolResult = await withTimeout(
                        (timeoutToken) => deps.invokeTool(call.name, {
                            input: call.input,
                            toolInvocationToken: toolToken
                        }, timeoutToken),
                        toolInvocationTimeout,
                        `Tool invocation: ${call.name}`,
                        token
                    );

                    // Check for error patterns in tool result
                    // Using pattern matching for robustness against format changes
                    const toolResultText = (toolResult.content || [])
                        .filter((c): c is vscode.LanguageModelTextPart => c instanceof vscode.LanguageModelTextPart)
                        .map(c => c.value)
                        .join('');

                    if (isToolResultError(toolResultText)) {
                        const errorSnippet = toolResultText.substring(0, 300);
                        toolErrors.push(`${call.name}: ${errorSnippet}`);
                        hooks.onPhaseComplete?.(`Error from ${call.name}`);
                    } else {
                        hooks.onPhaseComplete?.(`Called ${call.name}`);
                    }

                    // Add tool result to messages (truncated to bound token usage)
                    messages.push(
                        vscode.LanguageModelChatMessage.User([
                            new vscode.LanguageModelToolResultPart(
                                call.callId,
                                truncateResultContent(toolResult.content, maxToolResponseLength)
                            )
                        ])
                    );
                } catch (toolError) {
                    // Track and add error result with specific timeout handling
                    const errorText = isTimeoutError(toolError)
                        ? `Timed out after ${toolError.timeoutMs}ms`
                        : (toolError instanceof Error ? toolError.message : String(toolError));
                    toolErrors.push(`${call.name}: ${errorText}`);
                    hooks.onPhaseComplete?.(`Failed: ${call.name}`);

                    messages.push(
                        vscode.LanguageModelChatMessage.User([
                            new vscode.LanguageModelToolResultPart(call.callId, [
                                new vscode.LanguageModelTextPart(`Error calling tool '${call.name}': ${errorText}`)
                            ])
                        ])
                    );
                }
            }

            // Show next phase - analyzing tool results
            hooks.onPhaseStart?.('Analyzing results');
        }

        // Max iterations reached
        return {
            stepId: step.id,
            success: false,
            error: `Max tool iterations (${maxToolIterations}) reached`,
            duration: Date.now() - stepStart,
            prompt,
            toolsUsed: toolsInvoked
        };

    } catch (error) {
        return {
            stepId: step.id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            duration: Date.now() - stepStart,
            prompt,
            toolsUsed: toolsInvoked.length > 0 ? toolsInvoked : undefined
        };
    } finally {
        // Ensure streaming is always closed even on unexpected errors
        if (streamingActive) {
            hooks.onStreamEnd?.();
        }
    }
}
