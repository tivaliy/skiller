/**
 * Tests that the panel manager serves captured step inspection data to the webview:
 * - handleRequestStepInspection posts a `stepInspection` message (data or null) to the panel.
 * - getStepInspection returns the captured data (used by the copy-to-clipboard path).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { panelManager } from '../../../../src/skills/graph';
import { ExecutionStateEmitter } from '../../../../src/skills/execution-state';
import type { StepInspection } from '../../../../src/skills/execution-state';
import { createMockSkill } from '../../../helpers/mocks/skill';

function fakePanel() {
    const messages: Array<Record<string, unknown>> = [];
    const panel = {
        webview: {
            postMessage: vi.fn((m: Record<string, unknown>) => { messages.push(m); return Promise.resolve(true); }),
            onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() }))
        },
        onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
        reveal: vi.fn(),
        dispose: vi.fn()
    } as unknown as vscode.WebviewPanel;
    return { panel, messages };
}

const sample: StepInspection = {
    kind: 'llm',
    prompt: 'P',
    response: 'R',
    modelUsed: 'm',
    toolsUsed: ['t'],
    durationMs: 4,
    status: 'completed'
};

describe('panelManager step inspection serving', () => {
    afterEach(() => panelManager.disposeAll());

    it('posts stepInspection with the captured data on request', () => {
        const es = new ExecutionStateEmitter();
        es.startExecution('s', ['a']);
        es.recordStepInspection('s', 'a', sample);
        panelManager.connectExecutionState(es);

        const fp = fakePanel();
        panelManager.register('s', createMockSkill({ id: 's' }), fp.panel, () => {});

        panelManager.handleRequestStepInspection('s', 'a');

        const msg = fp.messages.find(m => m.type === 'stepInspection');
        expect(msg).toMatchObject({ type: 'stepInspection', stepId: 'a', data: sample });
    });

    it('posts stepInspection with null data when nothing was captured', () => {
        const es = new ExecutionStateEmitter();
        es.startExecution('s', ['a']);
        panelManager.connectExecutionState(es);

        const fp = fakePanel();
        panelManager.register('s', createMockSkill({ id: 's' }), fp.panel, () => {});

        panelManager.handleRequestStepInspection('s', 'a');

        const msg = fp.messages.find(m => m.type === 'stepInspection');
        expect(msg).toMatchObject({ type: 'stepInspection', stepId: 'a', data: null });
    });

    it('getStepInspection returns the captured data, or undefined when absent', () => {
        const es = new ExecutionStateEmitter();
        es.startExecution('s', ['a']);
        es.recordStepInspection('s', 'a', sample);
        panelManager.connectExecutionState(es);

        expect(panelManager.getStepInspection('s', 'a')).toEqual(sample);
        expect(panelManager.getStepInspection('s', 'missing')).toBeUndefined();
    });
});
