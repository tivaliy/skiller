/**
 * Markdown → HTML for graph-panel cards.
 *
 * Uses VS Code's built-in Markdown renderer (no extra dependency). When it is
 * unavailable (the Markdown extension is disabled) or returns something
 * unexpected, the text is shown escaped in a <pre>. The webview sanitizes card
 * HTML with an allow-list either way.
 */

import * as vscode from 'vscode';

export async function renderCardMarkdown(md: string): Promise<string> {
    try {
        const html = await vscode.commands.executeCommand<unknown>('markdown.api.render', md);
        if (typeof html === 'string') return html;
    } catch {
        // Fall through to the plain rendering.
    }
    return `<pre>${escapeHtml(md)}</pre>`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
