/**
 * Tests for the tool-step runner (S-17: now unit-testable via injected deps).
 */

import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { executeToolStep } from '../../../src/skills/handlers/runners/tool-runner';
import type { ToolRunnerDeps } from '../../../src/skills/handlers/runners/tool-runner';
import type { SkillStep, ToolInvocationToken } from '../../../src/skills/types';
import type { ProgressHooks } from '../../../src/skills/progress-hooks';

const STEP: SkillStep = { id: 'save', type: 'tool', tool: 'create_file' };
const HOOKS: ProgressHooks = {};

const TOKEN = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} })
} as unknown as vscode.CancellationToken;

function tool(name: string): vscode.LanguageModelToolInformation {
    return { name, description: '', inputSchema: {} } as unknown as vscode.LanguageModelToolInformation;
}

function toolResult(text: string): vscode.LanguageModelToolResult {
    return { content: [{ value: text }] } as unknown as vscode.LanguageModelToolResult;
}

function makeDeps(overrides: Partial<ToolRunnerDeps> = {}): ToolRunnerDeps {
    return {
        findTool: (name) => tool(name),
        invokeTool: async () => toolResult('ok'),
        timeoutMs: 1000,
        ...overrides
    };
}

describe('executeToolStep', () => {
    it('does not invoke a declined tool and fails the step', async () => {
        const invokeTool = vi.fn<ToolRunnerDeps['invokeTool']>(async () => toolResult('done'));
        const approveTool = vi.fn(async () => false);
        const result = await executeToolStep(
            STEP, 'create_file', { filePath: 'a.md' }, TOKEN, undefined, Date.now(), HOOKS, makeDeps({ invokeTool, approveTool })
        );
        expect(approveTool).toHaveBeenCalledWith({ toolName: 'create_file', input: { filePath: 'a.md' } });
        expect(invokeTool).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
        expect(result.error).toBe('create_file: The user declined to run this tool.');
    });

    it('invokes an approved tool', async () => {
        const invokeTool = vi.fn<ToolRunnerDeps['invokeTool']>(async () => toolResult('done'));
        const result = await executeToolStep(
            STEP, 'create_file', {}, TOKEN, undefined, Date.now(), HOOKS, makeDeps({ invokeTool, approveTool: async () => true })
        );
        expect(invokeTool).toHaveBeenCalledTimes(1);
        expect(result.success).toBe(true);
    });

    it('invokes the tool and returns extracted data on success', async () => {
        const invokeTool = vi.fn<ToolRunnerDeps['invokeTool']>(async () => toolResult('done'));
        const deps = makeDeps({ invokeTool });

        const result = await executeToolStep(
            STEP, 'create_file', { filePath: 'a.md' }, TOKEN, undefined, Date.now(), HOOKS, deps
        );

        expect(result.success).toBe(true);
        expect(result.data).toBe('done');
        expect(result.toolName).toBe('create_file');
        // params + tool name are forwarded to the invoker
        expect(invokeTool).toHaveBeenCalledOnce();
        expect(invokeTool.mock.calls[0][0]).toBe('create_file');
        expect(invokeTool.mock.calls[0][1].input).toEqual({ filePath: 'a.md' });
    });

    it('passes the caller tool token through to invokeTool unchanged', async () => {
        const toolToken = { opaque: 1 } as unknown as ToolInvocationToken;
        const invokeTool = vi.fn<ToolRunnerDeps['invokeTool']>(async () => toolResult('done'));
        await executeToolStep(STEP, 'create_file', {}, TOKEN, toolToken, Date.now(), HOOKS, makeDeps({ invokeTool }));
        expect(invokeTool.mock.calls[0][1]).toMatchObject({ toolInvocationToken: toolToken });
    });

    it('fails cleanly when the tool is not found', async () => {
        const deps = makeDeps({ findTool: () => undefined });

        const result = await executeToolStep(
            STEP, 'missing', {}, TOKEN, undefined, Date.now(), HOOKS, deps
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Tool not found');
    });

    it('reports invocation errors as a failed step', async () => {
        const deps = makeDeps({
            invokeTool: async () => { throw new Error('boom'); }
        });

        const result = await executeToolStep(
            STEP, 'create_file', {}, TOKEN, undefined, Date.now(), HOOKS, deps
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Tool invocation failed');
        expect(result.error).toContain('boom');
    });

    it('times out (and reports it) when the tool never resolves', async () => {
        const deps = makeDeps({
            invokeTool: () => new Promise<vscode.LanguageModelToolResult>(() => { /* never resolves */ }),
            timeoutMs: 10
        });

        const result = await executeToolStep(
            STEP, 'create_file', {}, TOKEN, undefined, Date.now(), HOOKS, deps
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('timed out');
    });
});
