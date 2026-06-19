/**
 * Tests for refreshOpenPanels (S-11): /reload must re-render open panels for
 * skills that still exist and close panels for skills that were removed — not
 * only handle the removed case.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { panelManager, refreshOpenPanels } from '../../../../src/skills/graph';
import { createMockSkill } from '../../../helpers/mocks/skill';

function fakePanel() {
    const messages: Array<{ type: string }> = [];
    const panel = {
        webview: {
            postMessage: vi.fn((m: { type: string }) => { messages.push(m); return Promise.resolve(true); }),
            onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() }))
        },
        onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
        reveal: vi.fn(),
        dispose: vi.fn()
    } as unknown as vscode.WebviewPanel;
    return { panel, messages };
}

describe('refreshOpenPanels', () => {
    afterEach(() => panelManager.disposeAll());

    it('re-renders the panel of a still-present (edited) skill in place', async () => {
        const skill = createMockSkill({ id: 'present', name: 'Present' });
        const fp = fakePanel();
        panelManager.register('present', skill, fp.panel, () => {});

        await refreshOpenPanels(id => (id === 'present' ? skill : undefined));

        expect(fp.messages.some(m => m.type === 'updateGraph')).toBe(true);
        expect(panelManager.getOpenSkillIds()).toContain('present');
    });

    it('closes the panel of a skill that no longer exists', async () => {
        const fp = fakePanel();
        panelManager.register('gone', createMockSkill({ id: 'gone' }), fp.panel, () => {});

        await refreshOpenPanels(() => undefined);

        expect(fp.panel.dispose).toHaveBeenCalled();
        expect(panelManager.getOpenSkillIds()).not.toContain('gone');
    });
});
