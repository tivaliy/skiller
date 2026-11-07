import { describe, it, expect, vi, beforeEach } from 'vitest';

const editorState: { active: unknown } = { active: undefined };

vi.mock('vscode', async (orig) => {
    const real = await orig<typeof import('vscode')>();
    return {
        ...real,
        window: {
            get activeTextEditor() {
                return editorState.active;
            },
        },
    };
});

import { Uri } from 'vscode';
import { captureDeliveryTarget } from '../../../../src/skills/output/accessors';

function editorAt(fsPath: string) {
    return {
        document: { uri: Uri.file(fsPath), version: 3 },
        selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    };
}

describe('captureDeliveryTarget', () => {
    beforeEach(() => {
        editorState.active = undefined;
    });

    it('captures the active editor when no folder is excluded', () => {
        editorState.active = editorAt('/ws/src/notes.md');
        expect(captureDeliveryTarget()).toMatchObject({ version: 3 });
    });

    it('is undefined with no active editor', () => {
        expect(captureDeliveryTarget({ excludeDir: '/ws/.skiller/skills/t' })).toBeUndefined();
    });

    // A run must never write its output into the running skill's own definition
    // (e.g. the skill.yaml the create flow just opened).
    it.each([
        '/ws/.skiller/skills/t/skill.yaml',
        '/ws/.skiller/skills/t/steps/01-translate.md',
    ])('refuses a target inside the excluded skill folder: %s', (file) => {
        editorState.active = editorAt(file);
        expect(captureDeliveryTarget({ excludeDir: '/ws/.skiller/skills/t' })).toBeUndefined();
    });

    it.each([
        '/ws/src/notes.md',
        '/ws/.skiller/skills/t-other/skill.yaml', // sibling sharing the folder-name prefix
    ])('captures a target outside the excluded folder: %s', (file) => {
        editorState.active = editorAt(file);
        expect(captureDeliveryTarget({ excludeDir: '/ws/.skiller/skills/t' })).toMatchObject({ version: 3 });
    });
});
