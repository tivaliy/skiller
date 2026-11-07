/**
 * Allow-list sanitizer for host-rendered card HTML.
 *
 * Card HTML comes from markdown rendering of skill/model text with raw HTML
 * enabled, so it is untrusted. The webview CSP stops scripts but not forms,
 * links, or inline-styled overlays that could spoof Approve/Deny buttons.
 *
 * This function is embedded into the webview script via `toString()`, so it
 * must stay fully self-contained (no module-level references, no helpers) and
 * touches the DOM only through the injected `env`.
 */

/** Minimal DOM surface the sanitizer needs; satisfied by DOMParser + document. */
export interface SanitizerNode {
    nodeType: number;
    nodeName: string;
    textContent: string | null;
    childNodes: ArrayLike<SanitizerNode>;
    getAttribute?(name: string): string | null;
}
export interface SanitizerTarget {
    appendChild(child: SanitizerTarget): unknown;
    setAttribute?(name: string, value: string): void;
}
export interface SanitizerEnv {
    parse(html: string): { body: SanitizerNode };
    createFragment(): SanitizerTarget;
    createElement(tag: string): SanitizerTarget;
    createText(text: string): SanitizerTarget;
}

export function sanitizeCardHtml(html: string, env: SanitizerEnv): SanitizerTarget {
    const allowed = ' p br hr h1 h2 h3 h4 h5 h6 ul ol li strong b em i code pre blockquote table thead tbody tr th td span ';
    const classOk = ' code pre span ';
    const dropped = ' script style iframe object embed form input button meta base link svg math textarea select noscript template head title ';

    const copyChildren = (src: SanitizerNode, dest: SanitizerTarget): void => {
        for (let i = 0; i < src.childNodes.length; i++) {
            const node = src.childNodes[i];
            if (node.nodeType === 3) {
                dest.appendChild(env.createText(node.textContent || ''));
            } else if (node.nodeType === 1) {
                const tag = node.nodeName.toLowerCase();
                if (dropped.indexOf(' ' + tag + ' ') >= 0) {
                    continue;
                }
                if (tag === 'a') {
                    // Links are rendered as their text only: no href, no click-through.
                    dest.appendChild(env.createText(node.textContent || ''));
                } else if (allowed.indexOf(' ' + tag + ' ') >= 0) {
                    const el = env.createElement(tag);
                    const cls = node.getAttribute ? node.getAttribute('class') : null;
                    if (cls && classOk.indexOf(' ' + tag + ' ') >= 0 && el.setAttribute) {
                        const safe = cls.replace(/[^\w\- ]/g, '');
                        if (safe) {
                            el.setAttribute('class', safe);
                        }
                    }
                    copyChildren(node, el);
                    dest.appendChild(el);
                } else {
                    // Unknown element: drop the tag, keep its (sanitized) content.
                    copyChildren(node, dest);
                }
            }
        }
    };

    const out = env.createFragment();
    copyChildren(env.parse(html).body, out);
    return out;
}
