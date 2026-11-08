/**
 * After a skill is created: the registry is refreshed, the files are opened, and
 * the creation is reported to the caller (the migration notice records the version).
 */

import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { finishSkill } from '../../../src/editor/scaffold-finish';
import type { FinishDeps } from '../../../src/editor/scaffold-finish';
import type { CreatedSkill } from '../../../src/scaffold/types';

describe('finishSkill', () => {
    it('reports the creation even when opening the new files fails', async () => {
        vi.mocked(vscode.workspace.openTextDocument).mockRejectedValue(new Error('no editor'));
        const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onCreated = vi.fn(async () => {});
        const deps = {
            skillRegistry: { refresh: vi.fn(async () => {}), getById: vi.fn() },
            extensionUri: vscode.Uri.file('/ext'),
            onCreated,
        } as unknown as FinishDeps;

        await finishSkill({ id: 'fresh', dir: '/ws/.skiller/skills/fresh', tier: 'workspace' } as unknown as CreatedSkill, deps);

        expect(onCreated).toHaveBeenCalledTimes(1);
        logError.mockRestore();
    });
});
