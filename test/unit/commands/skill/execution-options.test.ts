import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { createExecutionOptions } from '../../../../src/commands/skill/execution-options';
import type { CommandContext } from '../../../../src/commands/types';

function useVerboseMode(mode: 'off' | 'on' | 'raw'): void {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: (key: string, def?: unknown) => (key === 'skills.verboseMode' ? mode : def),
        update: vi.fn(),
        has: vi.fn(),
        inspect: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>);
}

function fakeContext(md: string[]): CommandContext {
    return {
        stream: { markdown: (s: string) => { md.push(s); }, progress: vi.fn() },
        request: { toolInvocationToken: undefined },
        token: { isCancellationRequested: false },
        model: { id: 'm' },
        isAutoMode: true,
        toolCache: { getDiscoveredCategories: () => [] },
        executionState: {},
    } as unknown as CommandContext;
}

describe('createExecutionOptions (chat adapter)', () => {
    beforeEach(() => vi.mocked(vscode.workspace.getConfiguration).mockReset());

    it('builds stream hooks that honour verbose mode', () => {
        useVerboseMode('on');
        const md: string[] = [];
        const opts = createExecutionOptions(fakeContext(md), {});
        opts.hooks.onPromptDisplay?.('THE PROMPT');
        expect(md.join('')).toContain('THE PROMPT');
        expect('stream' in opts).toBe(false);
    });

    it('hides prompts when verbose mode is off', () => {
        useVerboseMode('off');
        const md: string[] = [];
        const opts = createExecutionOptions(fakeContext(md), {});
        opts.hooks.onPromptDisplay?.('THE PROMPT');
        expect(md.join('')).not.toContain('THE PROMPT');
    });
});
