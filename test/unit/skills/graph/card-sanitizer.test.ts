import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { sanitizeCardHtml, type SanitizerEnv, type SanitizerNode } from '../../../../src/skills/graph/elk/card-sanitizer';
import { buildCsp } from '../../../../src/skills/graph/webview-util';
import { ElkWebviewRenderer } from '../../../../src/skills/graph/elk/elk-webview-renderer';

type N = SanitizerNode & { attrs?: Record<string, string> };
const el = (name: string, children: N[] = [], attrs: Record<string, string> = {}): N => ({
    nodeType: 1, nodeName: name.toUpperCase(), attrs, childNodes: children,
    getAttribute: (k: string) => attrs[k] ?? null,
    get textContent() { return children.map(c => c.textContent ?? '').join(''); }
} as N);
const text = (t: string): N => ({ nodeType: 3, nodeName: '#text', textContent: t, childNodes: [] });

interface Out { tag: string; attrs: Record<string, string>; children: Out[]; text?: string }
function run(body: N[]): Out {
    const mk = (tag: string): Out & { appendChild(c: Out): void; setAttribute(k: string, v: string): void } => {
        const o = { tag, attrs: {} as Record<string, string>, children: [] as Out[],
            appendChild(c: Out) { o.children.push(c); },
            setAttribute(k: string, v: string) { o.attrs[k] = v; } };
        return o;
    };
    const env = {
        parse: () => ({ body: el('body', body) }),
        createFragment: () => mk('#frag'),
        createElement: (t: string) => mk(t),
        createText: (t: string) => ({ tag: '#text', attrs: {}, children: [], text: t, appendChild() {} })
    } as unknown as SanitizerEnv;
    return sanitizeCardHtml('', env) as unknown as Out;
}

describe('sanitizeCardHtml', () => {
    it('keeps allow-listed elements and strips every attribute but class on code/pre/span', () => {
        const out = run([el('p', [el('strong', [text('hi')], { style: 'x', onclick: 'y' }),
            el('span', [text('s')], { class: 'k bad"><x', style: 'position:fixed' }),
            el('p', [text('q')], { class: 'nope', id: 'z' })])]);
        const p = out.children[0];
        expect(p.tag).toBe('p');
        expect(p.children[0]).toMatchObject({ tag: 'strong', attrs: {} });
        expect(p.children[1].attrs).toEqual({}); // 'k' is not a highlighter class: dropped
        expect(p.children[2].attrs).toEqual({});
    });
    it('keeps a class only when every token is a highlighter class (hljs-* / language-*)', () => {
        const out = run([el('pre', [
            el('code', [el('span', [text('if')], { class: 'hljs-keyword' })], { class: 'language-ts' }),
            el('span', [text('a')], { class: 'hljs-title  hljs-function' }),
            el('span', [text('b')], { class: 'hljs-keyword card-dock-actions' }),
            el('code', [text('c')], { class: 'language-ts"><x' }),
            el('span', [text('d')], { class: 'hljs' }),
            el('span', [text('e')], { class: '   ' }),
        ])]);
        const [code, a, b, c, d, e] = out.children[0].children;
        expect(code.attrs).toEqual({ class: 'language-ts' });
        expect(code.children[0].attrs).toEqual({ class: 'hljs-keyword' });
        expect(a.attrs).toEqual({ class: 'hljs-title hljs-function' });
        expect(b.attrs).toEqual({});
        expect(c.attrs).toEqual({});
        expect(d.attrs).toEqual({});
        expect(e.attrs).toEqual({});
    });
    it('renders links as plain text without href', () => {
        const out = run([el('a', [text('click')], { href: 'https://evil' })]);
        expect(out.children).toEqual([expect.objectContaining({ tag: '#text', text: 'click' })]);
    });
    it('drops dangerous elements entirely, including their text', () => {
        const out = run([el('script', [text('alert')]), el('form', [text('f')]), el('button', [text('b')]),
            el('iframe'), el('style', [text('css')]), el('input'), el('base'), el('meta'), el('link')]);
        expect(out.children).toEqual([]);
    });
    it('unwraps unknown elements but keeps their text', () => {
        const out = run([el('div', [text('a'), el('img', [], { src: 'x' }), el('em', [text('b')])])]);
        expect(out.children.map(c => c.tag)).toEqual(['#text', 'em']);
    });
});

describe('card webview hardening', () => {
    const csp = buildCsp({ cspSource: 'csp:' } as unknown as vscode.Webview, 'n');
    it('CSP forbids form submission and base rewriting', () => {
        expect(csp).toContain("form-action 'none'");
        expect(csp).toContain("base-uri 'none'");
    });
    it('dock uses its own class names and does not redefine .card-body', () => {
        const r = new ElkWebviewRenderer(vscode.Uri.file('/ext'));
        const html = (r as unknown as { getHtml(p: unknown, w: unknown): string }).getHtml(
            { direction: 'TD', nodes: [], edges: [] }, { cspSource: 'csp:', asWebviewUri: (u: unknown) => u });
        expect(html).toContain('card-dock-title');
        expect(html).toContain('card-dock-body');
        expect(html).toContain('card-dock-actions');
        expect(html).toContain('contain: paint');
        expect(html).not.toMatch(/\.card-body pre/);
        expect(html).not.toMatch(/\.card-title\s*\{/);
        expect(html).not.toContain('body.innerHTML');
        expect(html).toContain('sanitizeCardHtml');
    });
});
