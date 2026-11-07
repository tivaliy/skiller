import { describe, it, expect, vi } from 'vitest';
import type * as vscode from 'vscode';
import { resolveNativeModel } from '../../../src/skills/model-selection';

const model = (id: string) => ({ id }) as unknown as vscode.LanguageModelChat;
type Select = (selector?: vscode.LanguageModelChatSelector) => Thenable<vscode.LanguageModelChat[]>;

describe('resolveNativeModel', () => {
    const a = model('a');
    const b = model('b');
    const deps = (over: Partial<Parameters<typeof resolveNativeModel>[0]> = {}) => ({
        select: vi.fn<Select>(async () => [a, b]),
        settingId: () => undefined as string | undefined,
        rememberedId: () => undefined as string | undefined,
        remember: vi.fn(async (_id: string) => {}),
        pick: vi.fn(async (models: vscode.LanguageModelChat[]) => models[0] as vscode.LanguageModelChat | undefined),
        ...over,
    });

    it('uses the setting when it matches', async () => {
        const d = deps({ settingId: () => 'b', rememberedId: () => 'a' });
        expect(await resolveNativeModel(d)).toEqual({ model: b, isAutoMode: true });
        expect(d.pick).not.toHaveBeenCalled();
    });

    it('falls back to the remembered model', async () => {
        const d = deps({ settingId: () => 'missing', rememberedId: () => 'b' });
        expect(await resolveNativeModel(d)).toEqual({ model: b, isAutoMode: true });
        expect(d.pick).not.toHaveBeenCalled();
    });

    it('asks once and remembers the pick', async () => {
        const d = deps({ pick: vi.fn(async () => b) });
        expect(await resolveNativeModel(d)).toEqual({ model: b, isAutoMode: true });
        expect(d.pick).toHaveBeenCalledTimes(1);
        expect(d.pick).toHaveBeenCalledWith([a, b]);
        expect(d.remember).toHaveBeenCalledWith('b');
    });

    it('throws when the user dismisses the pick', async () => {
        const d = deps({ pick: vi.fn(async () => undefined) });
        await expect(resolveNativeModel(d)).rejects.toThrow('No language model selected.');
        expect(d.remember).not.toHaveBeenCalled();
    });

    it('throws the provider error when no models exist', async () => {
        const d = deps({ select: vi.fn<Select>(async () => []) });
        await expect(resolveNativeModel(d)).rejects.toThrow('No language models available.');
        expect(d.pick).not.toHaveBeenCalled();
    });
});
