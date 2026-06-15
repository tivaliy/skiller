/**
 * Step Runner Utilities
 *
 * Shared utility functions for step execution:
 * - JSON parsing and extraction
 * - Tool result processing
 * - MCP tool lookup
 * - Timeout handling
 */

import * as vscode from 'vscode';

/**
 * Default timeout values (in milliseconds)
 */
export const DEFAULT_TIMEOUTS = {
    /** Default timeout for tool invocations */
    TOOL_INVOCATION: 60_000, // 1 minute
    /** Default timeout for parameter extraction */
    PARAM_EXTRACTION: 30_000 // 30 seconds
} as const;

/**
 * Custom error for timeout operations
 */
export class TimeoutError extends Error {
    constructor(
        message: string,
        public readonly timeoutMs: number,
        public readonly operation: string
    ) {
        super(message);
        this.name = 'TimeoutError';
    }
}

/**
 * Check if an error is a timeout error
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
    return error instanceof TimeoutError;
}

/**
 * Run an operation with a timeout, cancelling the operation if it elapses.
 *
 * The operation receives a CancellationToken that is cancelled when the timeout
 * fires (or when `parentToken` is cancelled), so the underlying work (e.g. an MCP
 * tool invocation) is actually aborted instead of left running in the background
 * after the caller has given up. Rejects with TimeoutError on timeout.
 */
export async function withTimeout<T>(
    operation: (token: vscode.CancellationToken) => Promise<T> | PromiseLike<T>,
    timeoutMs: number,
    operationName: string,
    parentToken?: vscode.CancellationToken
): Promise<T> {
    const cts = new vscode.CancellationTokenSource();
    const parentSub = parentToken?.onCancellationRequested(() => cts.cancel());
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            cts.cancel(); // abort the underlying operation, don't just unblock the caller
            reject(new TimeoutError(
                `Operation timed out after ${timeoutMs}ms: ${operationName}`,
                timeoutMs,
                operationName
            ));
        }, timeoutMs);
    });

    try {
        return await Promise.race([Promise.resolve(operation(cts.token)), timeoutPromise]);
    } finally {
        clearTimeout(timeoutId!);
        parentSub?.dispose();
        cts.dispose();
    }
}

/**
 * Try to parse text as JSON.
 * Handles direct JSON, markdown code blocks, and embedded JSON objects/arrays.
 */
export function tryParseJson(text: string): unknown {
    // Try direct parse
    try {
        return JSON.parse(text);
    } catch {
        // Continue to extraction
    }

    // Extract JSON from markdown code block
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[1].trim());
        } catch {
            // Continue
        }
    }

    // Extract JSON object
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        try {
            return JSON.parse(objectMatch[0]);
        } catch {
            // Continue
        }
    }

    // Extract JSON array
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
        try {
            return JSON.parse(arrayMatch[0]);
        } catch {
            // Continue
        }
    }

    return null;
}

/**
 * Extract data from tool result.
 * Handles VS Code's LanguageModelToolResult content parts.
 */
export function extractToolResultData(result: vscode.LanguageModelToolResult): unknown {
    // Tool results contain content parts
    if (result.content && Array.isArray(result.content)) {
        const textParts: string[] = [];

        for (const part of result.content) {
            // Check if this is a text part with a value property
            if (part && typeof part === 'object' && 'value' in part) {
                const textPart = part as { value: unknown };
                if (typeof textPart.value === 'string') {
                    textParts.push(textPart.value);
                }
            }
        }

        if (textParts.length === 1) {
            return tryParseJson(textParts[0]) || textParts[0];
        }

        if (textParts.length > 1) {
            const combined = textParts.join('\n');
            return tryParseJson(combined) || combined;
        }
    }

    return result;
}

/**
 * Find an MCP tool by exact name.
 * Use aliases in skill.yaml to map friendly names to exact tool names.
 */
export function findMcpTool(toolName: string): vscode.LanguageModelToolInformation | undefined {
    return vscode.lm.tools.find(t => t.name === toolName);
}
