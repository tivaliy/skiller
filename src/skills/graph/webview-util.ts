/**
 * Shared host-side helpers for building the skill-graph webview HTML:
 * a CSP nonce, media URIs, a strict Content-Security-Policy, and script-safe
 * JSON embedding. Kept separate from the renderer so the webview-construction
 * primitives stay small and individually testable.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';

/** Generate a cryptographically secure nonce for CSP-allowed inline scripts. */
export function getNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}

/** Resolve a webview URI for a bundled asset under media/. */
export function getMediaUri(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    filename: string
): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', filename));
}

// Characters that must be escaped before embedding JSON in a <script> tag:
// `<`, `>`, `&` (so sequences like "</script>" can't break out) and U+2028/U+2029
// (line/paragraph separators, which are invalid in JS string literals). Built from
// char codes to keep the source pure ASCII — U+2028/U+2029 are line terminators
// and cannot appear literally inside a regex literal.
const SCRIPT_UNSAFE = new RegExp('[<>&' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

/**
 * Serialize a value into JSON that is safe to embed directly into a <script> tag.
 */
export function toWebviewScriptJson(value: unknown): string {
    return JSON.stringify(value).replace(SCRIPT_UNSAFE, (c) =>
        '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
    );
}

/**
 * Build a strict Content-Security-Policy for a graph webview: no remote content,
 * scripts/styles allowed only via the nonce or the webview's own source.
 *
 * @param options.fontSrc - also allow fonts from the webview source
 */
export function buildCsp(
    webview: vscode.Webview,
    nonce: string,
    options: { fontSrc?: boolean } = {}
): string {
    const directives = [
        `default-src 'none'`,
        `script-src ${webview.cspSource} 'nonce-${nonce}'`,
        // The SVG cards set inline style attributes (foreignObject sizing), which
        // need 'unsafe-inline' — a nonce does not cover inline style attributes.
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `img-src ${webview.cspSource} data:`
    ];
    if (options.fontSrc) {
        directives.push(`font-src ${webview.cspSource}`);
    }
    return directives.join('; ');
}
