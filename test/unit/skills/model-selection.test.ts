import { describe, it, expect, vi } from 'vitest';
import type * as vscode from 'vscode';
import { resolveRequestModel } from '../../../src/skills/model-selection';

const model = (id: string) => ({ id }) as unknown as vscode.LanguageModelChat;
type Select = (selector?: vscode.LanguageModelChatSelector) => Thenable<vscode.LanguageModelChat[]>;

describe('resolveRequestModel', () => {
    it('returns a non-auto request model as-is', async () => {
        const m = model('gpt-x');
        const select = vi.fn<Select>(async () => []);
        expect(await resolveRequestModel(m, select)).toEqual({ model: m, isAutoMode: false });
        expect(select).not.toHaveBeenCalled();
    });

    it.each(['auto', 'Auto', 'copilot/auto'])('treats id %s as auto and prefers a copilot model', async (id) => {
        const c = model('copilot-1');
        const select = vi.fn<Select>(async (s) => (s?.vendor === 'copilot' ? [c] : []));
        expect(await resolveRequestModel(model(id), select)).toEqual({ model: c, isAutoMode: true });
    });

    it('falls back to any model when no copilot model exists', async () => {
        const any = model('other-1');
        const select = vi.fn<Select>(async (s) => (s?.vendor ? [] : [any]));
        expect(await resolveRequestModel(model('auto'), select)).toEqual({ model: any, isAutoMode: true });
    });

    it('throws a clear error when no model is available', async () => {
        await expect(resolveRequestModel(model('auto'), vi.fn<Select>(async () => []))).rejects.toThrow(
            'No language models available. Please ensure a language model provider (e.g. GitHub Copilot) is installed and signed in.'
        );
    });
});
