/**
 * Tests for the LLM-step runner agentic loop (S-17: testable via injected deps +
 * a fake model). Covers the no-tool path, the tool-call→analyze loop, tool-error
 * detection (S-16), and the iteration cap (runaway guard).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { executeLLMStep, truncateResultContent, trimMessageHistory } from '../../../src/skills/handlers/runners/llm-runner';
import type { LLMRunnerDeps } from '../../../src/skills/handlers/runners/llm-runner';
import type { SkillStep } from '../../../src/skills/types';
import type { ProgressHooks } from '../../../src/skills/progress-hooks';

const STEP: SkillStep = { id: 'analyze', type: 'llm' };
const HOOKS: ProgressHooks = {};

const TOKEN = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} })
} as unknown as vscode.CancellationToken;

type Part = vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart;

/** Fake model whose Nth sendRequest streams the Nth programmed part-list (last repeats). */
function fakeModel(responses: Part[][]): vscode.LanguageModelChat {
    let call = 0;
    return {
        id: 'fake-model',
        sendRequest: vi.fn(async () => {
            const parts = responses[Math.min(call, responses.length - 1)];
            call++;
            return {
                stream: (async function* () { for (const p of parts) yield p; })(),
                text: (async function* () { /* unused */ })()
            };
        })
    } as unknown as vscode.LanguageModelChat;
}

function toolResult(text: string): vscode.LanguageModelToolResult {
    return { content: [new vscode.LanguageModelTextPart(text)] } as unknown as vscode.LanguageModelToolResult;
}

function makeDeps(overrides: Partial<LLMRunnerDeps> = {}): LLMRunnerDeps {
    return {
        invokeTool: async () => toolResult('tool-output'),
        settings: {
            maxToolIterations: 10,
            toolInvocationTimeout: 1000,
            maxHistoryTurns: 20,
            maxToolResponseLength: 4000,
            maxToolResponses: 10
        },
        ...overrides
    };
}

const text = (s: string) => new vscode.LanguageModelTextPart(s);
const call = (id: string, name: string, input: Record<string, unknown> = {}) =>
    new vscode.LanguageModelToolCallPart(id, name, input);

describe('executeLLMStep', () => {
    beforeEach(() => {
        // The real API normalizes Assistant(content) to a parts array (the runner
        // pushes tool-call parts onto it); make the mock faithful to that.
        vi.mocked(vscode.LanguageModelChatMessage.Assistant).mockImplementation(
            (content) => ({
                role: 'assistant',
                content: Array.isArray(content) ? content : []
            }) as unknown as vscode.LanguageModelChatMessage
        );
    });

    it('returns the text response when no tools are called', async () => {
        const model = fakeModel([[text('hello world')]]);
        const result = await executeLLMStep(STEP, 'p', model, TOKEN, undefined, Date.now(), [], 'auto', HOOKS, makeDeps());

        expect(result.success).toBe(true);
        expect(result.data).toBe('hello world');
    });

    it('parses a JSON text response', async () => {
        const model = fakeModel([[text('{"answer": 42}')]]);
        const result = await executeLLMStep(STEP, 'p', model, TOKEN, undefined, Date.now(), [], 'auto', HOOKS, makeDeps());

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ answer: 42 });
    });

    it('runs the tool then analyzes the result', async () => {
        const model = fakeModel([[call('c1', 'mytool')], [text('final answer')]]);
        const invokeTool = vi.fn(async () => toolResult('tool says hi'));
        const result = await executeLLMStep(
            STEP, 'p', model, TOKEN, undefined, Date.now(), [], 'auto', HOOKS, makeDeps({ invokeTool })
        );

        expect(result.success).toBe(true);
        expect(result.data).toBe('final answer');
        expect(result.toolsUsed).toEqual(['mytool']);
        expect(invokeTool).toHaveBeenCalledOnce();
    });

    it('fails the step when a tool returns a framed error (S-16)', async () => {
        const model = fakeModel([[call('c1', 'mytool')], [text('done')]]);
        const invokeTool = vi.fn(async () => toolResult('Error calling tool mytool: nope'));
        const result = await executeLLMStep(
            STEP, 'p', model, TOKEN, undefined, Date.now(), [], 'auto', HOOKS, makeDeps({ invokeTool })
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Tool execution failed');
    });

    it('does NOT fail on legit output that merely starts with "Error:" (S-16 narrowing)', async () => {
        const model = fakeModel([[call('c1', 'mytool')], [text('done')]]);
        const invokeTool = vi.fn(async () => toolResult('Error: 0 results found'));
        const result = await executeLLMStep(
            STEP, 'p', model, TOKEN, undefined, Date.now(), [], 'auto', HOOKS, makeDeps({ invokeTool })
        );

        expect(result.success).toBe(true);
        expect(result.data).toBe('done');
    });

    it('stops at the iteration cap when the model keeps calling tools', async () => {
        const model = fakeModel([[call('c1', 'mytool')]]); // always a tool call
        const invokeTool = vi.fn(async () => toolResult('again'));
        const result = await executeLLMStep(
            STEP, 'p', model, TOKEN, undefined, Date.now(), [], 'auto', HOOKS,
            makeDeps({ invokeTool, settings: { maxToolIterations: 2, toolInvocationTimeout: 1000, maxHistoryTurns: 20, maxToolResponseLength: 4000, maxToolResponses: 10 } })
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Max tool iterations (2)');
        expect(invokeTool).toHaveBeenCalledTimes(2);
    });
});

describe('truncateResultContent', () => {
    const len = (parts: vscode.LanguageModelTextPart[]) =>
        parts.reduce((n, p) => n + p.value.length, 0);

    it('caps the WHOLE result, not each part (multi-part tools cannot escape the cap)', () => {
        // 4 parts × 100 chars = 400; cap at 250.
        const content = [text('a'.repeat(100)), text('b'.repeat(100)), text('c'.repeat(100)), text('d'.repeat(100))];
        const out = truncateResultContent(content, 250) as vscode.LanguageModelTextPart[];

        const kept = out.filter(p => !p.value.startsWith('\n…[truncated'));
        expect(len(kept)).toBe(250);
        // A single truncation marker reporting the total omitted chars (400 - 250).
        const marker = out.find(p => p.value.startsWith('\n…[truncated'));
        expect(marker?.value).toContain('150 chars');
    });

    it('passes content through untouched when under the cap', () => {
        const content = [text('short')];
        expect(truncateResultContent(content, 4000)).toEqual(content);
    });

    it('disables truncation for a non-positive cap (a misconfigured 0 cannot empty output)', () => {
        const content = [text('a'.repeat(5000))];
        const out = truncateResultContent(content, 0) as vscode.LanguageModelTextPart[];
        expect(len(out)).toBe(5000);
    });

    it('leaves non-text parts untouched', () => {
        const tc = call('c1', 'mytool');
        const out = truncateResultContent([tc, text('x'.repeat(10))], 5);
        expect(out[0]).toBe(tc);
    });
});

describe('trimMessageHistory', () => {
    // Construct messages directly (content controlled) so isToolResultMessage is
    // exercised without depending on the vscode mock's LanguageModelChatMessage.User.
    const user = (s: string) =>
        ({ role: 1, content: s }) as unknown as vscode.LanguageModelChatMessage;
    const toolResultMsg = (id: string) =>
        ({ role: 1, content: [new vscode.LanguageModelToolResultPart(id, [text('r')])] }) as unknown as vscode.LanguageModelChatMessage;

    it('always keeps the first (prompt) message', () => {
        const msgs = [user('prompt'), user('a'), user('b'), user('c')];
        const out = trimMessageHistory(msgs, 2, 10);
        expect(out[0]).toBe(msgs[0]);
    });

    it('caps the retained tail by turn count', () => {
        const msgs = [user('prompt'), user('a'), user('b'), user('c'), user('d')];
        // turnCap 3 → prompt + last 2 tail messages.
        const out = trimMessageHistory(msgs, 3, 10);
        expect(out).toEqual([msgs[0], msgs[3], msgs[4]]);
    });

    it('caps retained tool responses and never starts on an orphaned tool-result', () => {
        const msgs = [user('prompt'), toolResultMsg('t1'), user('a'), toolResultMsg('t2'), user('b')];
        // Allow many turns but only 1 tool response: t1 must be dropped, and the
        // tail must not begin on a leftover tool-result.
        const out = trimMessageHistory(msgs, 20, 1);
        expect(out[0]).toBe(msgs[0]);
        const toolResultsKept = out.slice(1).filter(m =>
            Array.isArray(m.content) && m.content.some((p: unknown) => p instanceof vscode.LanguageModelToolResultPart)
        );
        expect(toolResultsKept.length).toBeLessThanOrEqual(1);
        expect(Array.isArray(out[1].content) &&
            (out[1].content as unknown[]).some(p => p instanceof vscode.LanguageModelToolResultPart)).toBe(false);
    });

    it('returns the messages unchanged when nothing needs trimming', () => {
        const msgs = [user('prompt'), user('a')];
        expect(trimMessageHistory(msgs, 20, 10)).toBe(msgs);
    });
});
