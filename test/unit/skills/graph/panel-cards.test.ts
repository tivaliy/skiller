/**
 * Interactive cards in the graph panel: showCard posts a card to the webview
 * and resolves with the clicked action; clearCard removes it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { panelManager } from '../../../../src/skills/graph';
import type { GraphCard, WebviewMessage } from '../../../../src/skills/graph/types';
import { ElkWebviewRenderer } from '../../../../src/skills/graph/elk/elk-webview-renderer';
import { createMockSkill } from '../../../helpers/mocks/skill';

function fakePanel() {
    const messages: Array<Record<string, unknown>> = [];
    let receive: ((m: WebviewMessage) => void) | undefined;
    let dispose: (() => void) | undefined;
    const panel = {
        webview: {
            postMessage: vi.fn((m: Record<string, unknown>) => { messages.push(m); return Promise.resolve(true); }),
            onDidReceiveMessage: vi.fn((cb: (m: WebviewMessage) => void) => { receive = cb; return { dispose: vi.fn() }; })
        },
        onDidDispose: vi.fn((cb: () => void) => { dispose = cb; return { dispose: vi.fn() }; }),
        reveal: vi.fn(),
        dispose: vi.fn()
    } as unknown as vscode.WebviewPanel;
    return {
        panel,
        messages,
        fire: (m: WebviewMessage) => receive?.(m),
        close: () => dispose?.()
    };
}

function card(cardId: string): GraphCard {
    return {
        cardId,
        kind: 'confirmation',
        title: 'Proceed?',
        html: '<p>ok</p>',
        actions: [{ id: 'yes', label: 'Yes', primary: true }, { id: 'no', label: 'No' }]
    };
}

describe('panelManager cards', () => {
    afterEach(() => panelManager.disposeAll());

    it('posts the card and resolves with the clicked action', async () => {
        const fp = fakePanel();
        panelManager.register('s', createMockSkill({ id: 's' }), fp.panel, () => {});
        const p = panelManager.showCard('s', card('c1'));
        fp.fire({ type: 'cardAction', cardId: 'c1', actionId: 'yes' });
        await expect(p).resolves.toBe('yes');
        expect(fp.messages).toContainEqual({ type: 'showCard', card: card('c1') });
    });

    it('resolves undefined when no panel is open', async () => {
        await expect(panelManager.showCard('none', card('c'))).resolves.toBeUndefined();
    });

    it('resolves undefined when the panel closes while waiting', async () => {
        const fp = fakePanel();
        panelManager.register('s', createMockSkill({ id: 's' }), fp.panel, () => {});
        const p = panelManager.showCard('s', card('c1'));
        fp.close();
        await expect(p).resolves.toBeUndefined();
    });

    it('ignores a stale action for another card', async () => {
        const fp = fakePanel();
        panelManager.register('s', createMockSkill({ id: 's' }), fp.panel, () => {});
        const p = panelManager.showCard('s', card('c1'));
        let settled = false;
        void p.then(() => { settled = true; });
        fp.fire({ type: 'cardAction', cardId: 'c0', actionId: 'yes' });
        await Promise.resolve();
        expect(settled).toBe(false);
        fp.fire({ type: 'cardAction', cardId: 'c1', actionId: 'no' });
        await expect(p).resolves.toBe('no');
    });

    it('clearCard posts clearCard and resolves the waiter with undefined', async () => {
        const fp = fakePanel();
        panelManager.register('s', createMockSkill({ id: 's' }), fp.panel, () => {});
        const p = panelManager.showCard('s', card('c1'));
        panelManager.clearCard('s', 'c1');
        await expect(p).resolves.toBeUndefined();
        expect(fp.messages).toContainEqual({ type: 'clearCard', cardId: 'c1' });
    });

    it('re-posts a pending card when the webview signals ready', () => {
        const fp = fakePanel();
        panelManager.register('s', createMockSkill({ id: 's' }), fp.panel, () => {});
        void panelManager.showCard('s', card('c1'));
        fp.messages.length = 0;
        fp.fire({ type: 'ready' });
        expect(fp.messages).toContainEqual({ type: 'showCard', card: card('c1') });
    });
});

describe('graph webview html', () => {
    it('contains the card container and a cardAction handler', () => {
        const renderer = new ElkWebviewRenderer(vscode.Uri.file('/ext'));
        const getHtml = (renderer as unknown as {
            getHtml(p: unknown, w: unknown): string;
        }).getHtml.bind(renderer);
        const webview = {
            cspSource: 'csp:',
            asWebviewUri: (u: vscode.Uri) => u
        };
        const html = getHtml({ direction: 'TD', nodes: [], edges: [] }, webview);
        expect(html).toContain('id="card-dock"');
        expect(html).toContain("type: 'cardAction'");
        expect(html).toContain("case 'showCard'");
        expect(html).toContain("case 'clearCard'");
    });
});
