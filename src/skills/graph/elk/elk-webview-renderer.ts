/**
 * ELK Webview Renderer
 *
 * Displays a skill graph in a VS Code WebviewPanel using a hand-rolled SVG
 * renderer driven by the ELK layout engine (elk.bundled.js, vendored in media/).
 *
 * Design goals:
 * - The card IS the node box (foreignObject sized to the measured card), so
 *   arrows dock flush on the visible border — no hidden-rect anchor mismatch.
 * - Node sizes are MEASURED from the real card HTML before layout (two-pass),
 *   so nodes never overlap due to placeholder mis-sizing.
 * - ELK produces true orthogonal edge routing with port docking.
 *
 * The webview loads ELK + svg-pan-zoom as nonce'd <script> tags under a strict
 * CSP (default-src 'none').
 */

import * as vscode from 'vscode';

import type { ElkGraphPayload, GraphWebviewOptions } from '../types';
import { buildCsp, getMediaUri, getNonce, toWebviewScriptJson } from '../webview-util';

/**
 * Renders a skill graph in a VS Code WebviewPanel using ELK + SVG.
 */
export class ElkWebviewRenderer {
    private static readonly VIEW_TYPE = 'skillGraphElk';

    constructor(private readonly extensionUri: vscode.Uri) {}

    /**
     * Show a skill graph in a webview panel.
     */
    show(title: string, payload: ElkGraphPayload, options: GraphWebviewOptions = {}): vscode.WebviewPanel {
        const column = options.column ?? vscode.ViewColumn.Beside;

        const panel = vscode.window.createWebviewPanel(
            ElkWebviewRenderer.VIEW_TYPE,
            `Graph: ${title}`,
            { viewColumn: column, preserveFocus: options.preserveFocus ?? true },
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
            }
        );

        panel.webview.html = this.getHtml(payload, panel.webview);
        return panel;
    }

    private getHtml(payload: ElkGraphPayload, webview: vscode.Webview): string {
        const nonce = getNonce();
        const payloadJson = toWebviewScriptJson(payload);

        const elkUri = getMediaUri(webview, this.extensionUri, 'elk.bundled.js');
        const panZoomUri = getMediaUri(webview, this.extensionUri, 'svg-pan-zoom.min.js');

        const csp = buildCsp(webview, nonce, { fontSrc: true });

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <title>Skill Graph</title>
    <style nonce="${nonce}">${STYLES}</style>
</head>
<body>
    <div class="toolbar">
        <button id="zoom-out" title="Zoom out" aria-label="Zoom out">−</button>
        <button id="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
        <button id="fit" title="Fit to view" aria-label="Fit to view">⤢ Fit</button>
        <button id="dir-toggle" title="Toggle layout direction (top-down / left-right)" aria-label="Toggle layout direction">⇅ TD</button>
        <span id="zoom-level" class="zoom-level">100%</span>
        <span class="toolbar-spacer"></span>
        <button id="follow-toggle" class="toggle" title="Pan to the active step during a run" aria-label="Follow active step">Follow</button>
    </div>

    <div id="model-override-banner" class="model-override-banner is-hidden">
        <span>⚠️ Model Override:</span> <span id="model-override-name"></span>
    </div>

    <div id="error" class="error is-hidden"></div>
    <div id="warning" class="warning is-hidden">
        <div class="warning-header" id="warning-header">
            <span><span id="warning-title" class="warning-title"></span> <span id="warning-count" class="warning-count"></span></span>
            <button class="warning-toggle" id="warning-toggle" title="Toggle warning details" aria-label="Toggle warning details">▾</button>
        </div>
        <div class="warning-body" id="warning-body"></div>
    </div>
    <div id="loading" class="loading">Laying out graph…</div>

    <div class="graph-wrapper">
        <svg id="graph" xmlns="http://www.w3.org/2000/svg"></svg>
        <div class="legend">
            <div class="legend-title">Step Types</div>
            <div class="legend-item"><span class="legend-swatch swatch-tool"></span>Tool</div>
            <div class="legend-item"><span class="legend-swatch swatch-llm"></span>LLM</div>
            <div class="legend-item"><span class="legend-swatch swatch-confirm"></span>Confirmation</div>
        </div>
    </div>

    <!-- Hover inspector popover for executed nodes (positioned at runtime) -->
    <div id="inspection-popover" class="node-popover is-hidden"></div>

    <!-- Off-screen container used to measure real card sizes before layout -->
    <div id="measure" aria-hidden="true"></div>

    <script nonce="${nonce}" src="${elkUri}"></script>
    <script nonce="${nonce}" src="${panZoomUri}"></script>
    <script nonce="${nonce}">
        var INITIAL_PAYLOAD = ${payloadJson};
    </script>
    <script nonce="${nonce}">${CLIENT}</script>
</body>
</html>`;
    }
}

// ============================================================================
// Webview stylesheet (uses --vscode-* tokens so it adapts to the editor theme)
// ============================================================================

const STYLES = `
:root {
    --graph-tool: var(--vscode-charts-blue);
    --graph-llm: var(--vscode-charts-green);
    --graph-confirm: var(--vscode-charts-orange);
    --graph-error: var(--vscode-charts-red);
    --graph-terminal: var(--vscode-descriptionForeground, #888);
    --graph-model: var(--vscode-charts-purple);
    --edge-color: var(--vscode-descriptionForeground, #888);
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; padding: 0; }
body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.is-hidden { display: none !important; }

.toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
    flex: 0 0 auto;
}
.toolbar button {
    font: inherit;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
    border: none;
    border-radius: 4px;
    padding: 2px 10px;
    cursor: pointer;
}
.toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
.toolbar button.toggle.is-active {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
}
.toolbar-spacer { flex: 1; }
.zoom-level { color: var(--vscode-descriptionForeground); font-size: 12px; min-width: 42px; text-align: center; }

.model-override-banner {
    padding: 4px 10px;
    font-size: 12px;
    color: var(--vscode-inputValidation-warningForeground, inherit);
    background: color-mix(in srgb, var(--graph-confirm) 15%, var(--vscode-editor-background));
    border-bottom: 1px solid var(--graph-confirm);
}
.error {
    padding: 10px 14px;
    color: var(--vscode-inputValidation-errorForeground, inherit);
    background: var(--vscode-inputValidation-errorBackground, rgba(255,0,0,0.1));
    border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, var(--graph-error));
    white-space: pre-wrap;
}
.warning {
    font-size: 12px;
    color: var(--vscode-inputValidation-warningForeground, inherit);
    background: var(--vscode-inputValidation-warningBackground, color-mix(in srgb, var(--graph-confirm) 12%, var(--vscode-editor-background)));
    border-bottom: 1px solid var(--vscode-inputValidation-warningBorder, var(--graph-confirm));
}
.warning-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 14px;
    cursor: pointer;
    user-select: none;
}
.warning-header:hover { background: color-mix(in srgb, var(--graph-confirm) 8%, transparent); }
.warning-title { font-weight: 600; }
.warning-count { color: var(--vscode-descriptionForeground); }
.warning-toggle { font: inherit; color: inherit; background: none; border: none; cursor: pointer; padding: 0 4px; }
.warning-body { padding: 0 14px 8px; white-space: pre-wrap; }
.warning-body.is-collapsed { display: none; }
.loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vscode-descriptionForeground);
    pointer-events: none;
}

.graph-wrapper { position: relative; flex: 1 1 auto; overflow: hidden; }
#graph { width: 100%; height: 100%; cursor: grab; }
#graph:active { cursor: grabbing; }

#measure {
    position: absolute;
    top: -10000px;
    left: -10000px;
    visibility: hidden;
    pointer-events: none;
}

/* ---- Node cards ---- */
.node-card {
    width: 100%;
    height: 100%;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 2px solid var(--card-color, var(--graph-llm));
    border-left-width: 4px;
    /* Lift the card a few % off the editor canvas so it reads as an object. */
    background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-editor-background)) 92%, var(--vscode-foreground));
    overflow: hidden;
    cursor: pointer;
}
#measure .node-card { max-width: 260px; min-width: 120px; height: auto; }
#measure .measure-label { display: inline-block; font-size: 11px; white-space: nowrap; }
.node-card.card-type-tool { --card-color: var(--graph-tool); }
.node-card.card-type-llm { --card-color: var(--graph-llm); }
.node-card.card-type-confirmation { --card-color: var(--graph-confirm); border-style: dashed; }
.node-card:hover { background: var(--vscode-list-hoverBackground, var(--vscode-editorWidget-background)); }

.card-header {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    /* Step id label — full foreground so it stays legible. */
    color: var(--vscode-foreground, var(--vscode-editor-foreground));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.card-body {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    word-break: break-word;
}
.card-footer { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.card-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    white-space: nowrap;
}
.card-badge.badge-model {
    background: color-mix(in srgb, var(--graph-model) 30%, var(--vscode-badge-background));
}

/* ---- Edges ---- */
.edge-path {
    fill: none;
    stroke: var(--edge-color);
    stroke-width: 1.5px;
}
/* Visual hierarchy: solid = forward flow, dashed = jump/loop-back */
.edge-path.kind-goto { stroke-dasharray: 6 5; }
.edge-path.kind-terminal { opacity: 0.8; }
.edge-arrow { fill: var(--edge-color); }
/* Live execution path. The webview infers the traversed edge from the order of
   highlightStep events (previous-active -> newly-active node). */
@keyframes dashFlow { to { stroke-dashoffset: -18; } }
/* Static trail of transitions already taken this run */
.edge-path.edge-traversed {
    stroke: color-mix(in srgb, var(--graph-llm) 70%, var(--edge-color));
    stroke-width: 2px;
    stroke-dasharray: none;
    opacity: 1;
}
/* The transition currently flowing (marching ants) */
.edge-path.edge-flowing {
    stroke: var(--graph-llm);
    stroke-width: 2.25px;
    stroke-dasharray: 5 4;
    opacity: 1;
    animation: dashFlow 0.55s linear infinite;
}

.edge-label-bg {
    fill: var(--vscode-editor-background);
    stroke: var(--vscode-panel-border, transparent);
    rx: 4;
}
.edge-label-text {
    fill: var(--vscode-editor-foreground);
    font-size: 11px;
    dominant-baseline: middle;
    text-anchor: middle;
}

/* ---- Terminals ---- */
.terminal-outer { fill: none; stroke: var(--graph-terminal); stroke-width: 1.5px; }
.terminal-dot { fill: var(--graph-terminal); }
.terminal-label {
    fill: var(--vscode-descriptionForeground);
    font-size: 9px;
    text-anchor: middle;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* ---- Live execution states ---- */
@keyframes nodePop {
    0% { transform: scale(0.95); }
    55% { transform: scale(1.035); }
    100% { transform: scale(1); }
}
/* Active-step pulse. Cards sit in an SVG <foreignObject>, which clips any glow
   drawn outside the card box, so the pulse stays inside (background tint + inset
   shadow). An outer drop-shadow would be clipped and costs a per-frame redraw. */
@keyframes nodeGlow {
    0%, 100% {
        background: color-mix(in srgb, var(--card-color) 8%, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
        box-shadow: inset 0 0 9px color-mix(in srgb, var(--card-color) 30%, transparent);
    }
    50% {
        background: color-mix(in srgb, var(--card-color) 24%, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
        box-shadow: inset 0 0 20px color-mix(in srgb, var(--card-color) 65%, transparent);
    }
}
.node-card { transform-origin: center; }
.node .node-card { transition: filter 200ms ease, border-color 200ms ease, opacity 200ms ease; }
.node.node-pending { opacity: 0.45; }
/* Thicker border for the active and awaiting-input states. */
.node.node-active .node-card, .node.node-awaiting-input .node-card { border-width: 3px; border-left-width: 4px; }
.node.node-active .node-card {
    /* Colour pulse + a one-shot pop on activation. */
    animation: nodeGlow 1.5s ease-in-out infinite, nodePop 280ms ease-out;
}
/* Awaiting input: the active pulse, slower, to read as waiting rather than running. */
.node.node-awaiting-input .node-card { animation: nodeGlow 2.4s ease-in-out infinite; }
/* Completed: a ✓ mark so a finished node is distinct from an idle one. */
.node.node-completed .node-card { filter: drop-shadow(0 0 3px var(--card-color)); }
.node.node-completed .card-header { padding-right: 16px; }
.node.node-completed .node-card::after {
    content: '✓';
    position: absolute;
    top: 7px;
    right: 9px;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    color: var(--graph-llm);
}
/* Error: the same pulse, retinted red via --card-color. */
.node.node-error .node-card { --card-color: var(--graph-error); border-color: var(--graph-error); animation: nodeGlow 1.4s ease-in-out infinite; }
.node.node-skipped { opacity: 0.5; }
.node.node-skipped .node-card { border-style: dashed; }
.node.terminal-active .terminal-outer, .node.terminal-active .terminal-dot { filter: drop-shadow(0 0 6px var(--graph-llm)); }
.node.terminal-completed .terminal-outer, .node.terminal-completed .terminal-dot { stroke: var(--graph-llm); fill: var(--graph-llm); }

/* ---- Legend ---- */
.legend {
    position: absolute;
    right: 12px;
    bottom: 12px;
    padding: 8px 10px;
    font-size: 11px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--vscode-editor-background) 92%, transparent);
    border: 1px solid var(--vscode-panel-border, transparent);
}
.legend-title { font-weight: 600; margin-bottom: 4px; color: var(--vscode-descriptionForeground); }
.legend-item { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
.legend-swatch { width: 12px; height: 12px; border-radius: 3px; border: 2px solid; }
.legend-swatch.swatch-tool { border-color: var(--graph-tool); }
.legend-swatch.swatch-llm { border-color: var(--graph-llm); }
.legend-swatch.swatch-confirm { border-color: var(--graph-confirm); border-style: dashed; }

/* ---- Inspection popover (hover an executed node to inspect prompt/response) ---- */
.node-popover {
    position: fixed;
    z-index: 50;
    width: 340px;
    max-height: 360px;
    display: flex;
    flex-direction: column;
    padding: 8px 10px;
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, #555));
    border-radius: 6px;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    font-size: 12px;
    overflow: hidden;
}
.popover-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    flex: 0 0 auto;
}
.popover-meta { color: var(--vscode-descriptionForeground); font-size: 11px; }
.popover-actions { display: flex; gap: 4px; flex: 0 0 auto; }
.popover-btn {
    font: inherit;
    font-size: 11px;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
    border: none;
    border-radius: 4px;
    padding: 1px 8px;
    cursor: pointer;
}
.popover-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.popover-section {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    margin: 4px 0 2px;
}
.popover-pre {
    margin: 0;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-y: auto;
    max-height: 120px;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.1));
    padding: 6px 8px;
    border-radius: 4px;
}
.popover-error { color: var(--vscode-errorForeground, var(--graph-error)); }
.popover-empty { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 2px 0; }
`;

// ============================================================================
// Webview client script (no template literals / no ${} — embedded verbatim)
// ============================================================================

const CLIENT = `
(function () {
    var vscodeApi = acquireVsCodeApi();
    var storedState = vscodeApi.getState();
    var savedState = storedState || { zoom: 1, panX: 0, panY: 0, follow: false };

    var SVG_NS = 'http://www.w3.org/2000/svg';
    var XHTML_NS = 'http://www.w3.org/1999/xhtml';
    var TERMINAL_SIZE = 18;

    var svg = document.getElementById('graph');
    var measureEl = document.getElementById('measure');
    var loadingEl = document.getElementById('loading');
    var errorEl = document.getElementById('error');
    var warningEl = document.getElementById('warning');
    var warningTitleEl = document.getElementById('warning-title');
    var warningCountEl = document.getElementById('warning-count');
    var warningBodyEl = document.getElementById('warning-body');
    var warningToggleEl = document.getElementById('warning-toggle');
    var warningHeaderEl = document.getElementById('warning-header');
    var zoomLevelEl = document.getElementById('zoom-level');
    var followBtn = document.getElementById('follow-toggle');
    var dirBtn = document.getElementById('dir-toggle');
    var popoverEl = document.getElementById('inspection-popover');

    var elk = new ELK();
    var panZoom = null;
    var nodeEls = {};               // node id -> <g>
    var edgePathsByFromTo = {};     // from -> to -> [<path>] (for traversed-edge animation)
    var lastActiveStep = null;      // previously-active step, to infer the traversed edge
    var flowingPaths = [];          // the edge currently animated as "flowing"
    var currentPayload = INITIAL_PAYLOAD;
    var hoverStepId = null;          // step currently hovered (intent)
    var popoverPending = null;       // step we've requested data for (awaiting response)
    var popoverAnchor = null;        // card element the popover is anchored to
    var hoverShowTimer = null;
    var hoverHideTimer = null;
    var HOVER_SHOW_DELAY = 350;
    var HOVER_HIDE_DELAY = 200;
    var followActive = !!savedState.follow;
    var warningsCollapsed = !!savedState.warningsCollapsed;
    if (followActive) { followBtn.classList.add('is-active'); }
    // Restore the last-chosen layout direction (toolbar toggle), if any.
    if (storedState && (storedState.direction === 'LR' || storedState.direction === 'TD')) {
        currentPayload.direction = storedState.direction;
    }

    function show(el) { el.classList.remove('is-hidden'); }
    function hide(el) { el.classList.add('is-hidden'); }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function saveState() {
        if (!panZoom) return;
        var pan = panZoom.getPan();
        vscodeApi.setState({ zoom: panZoom.getZoom(), panX: pan.x, panY: pan.y, follow: followActive, direction: currentPayload.direction, warningsCollapsed: warningsCollapsed });
    }

    function showWarning(title, message, count) {
        warningTitleEl.textContent = title || 'Warning';
        warningCountEl.textContent = count ? '(' + count + ')' : '';
        warningBodyEl.textContent = message || '';
        warningBodyEl.classList.toggle('is-collapsed', warningsCollapsed);
        warningToggleEl.textContent = warningsCollapsed ? '▸' : '▾';
        show(warningEl);
    }

    function updateDirButton() {
        dirBtn.textContent = currentPayload.direction === 'LR' ? '⇄ LR' : '⇅ TD';
    }

    function isTerminal(node) { return node.kind === 'start' || node.kind === 'end'; }

    // ---- Card markup -------------------------------------------------------

    function cardHtml(node) {
        var html = '<div class="node-card card-type-' + escapeHtml(node.kind) + '" data-node-id="' + escapeHtml(node.id) + '">';
        html += '<div class="card-header">' + escapeHtml(node.header || node.id) + '</div>';
        if (node.body) {
            html += '<div class="card-body">' + escapeHtml(node.body) + '</div>';
        }
        var badges = '';
        if (node.tools) {
            for (var i = 0; i < node.tools.length; i++) {
                badges += '<span class="card-badge badge-tool">🔧 ' + escapeHtml(node.tools[i]) + '</span>';
            }
        }
        if (node.model) {
            badges += '<span class="card-badge badge-model" data-model-badge="1">🧠 ' + escapeHtml(node.model) + '</span>';
        }
        if (badges) { html += '<div class="card-footer">' + badges + '</div>'; }
        html += '</div>';
        return html;
    }

    // ---- Pass 1: measure real card + edge-label sizes ----------------------

    // Cards and labels are written once and read once (write-all-then-read-all)
    // so the browser does a single layout reflow per measure, not one per node.
    // Sizes depend only on payload content, not layout direction, so the result
    // is cached and reused across direction toggles (same payload object).
    var measuredSizes = null;     // { nodes: {id->{w,h}}, labels: {edgeId->{w,h}} }
    var measuredFor = null;       // payload the cache was built for

    function measureGraph(payload) {
        if (measuredFor === payload && measuredSizes) { return measuredSizes; }

        var nodeSizes = {};
        var labelSizes = {};
        var cardNodes = [];
        var labelEdges = [];
        var html = '';
        for (var i = 0; i < payload.nodes.length; i++) {
            var node = payload.nodes[i];
            if (isTerminal(node)) {
                nodeSizes[node.id] = { width: TERMINAL_SIZE, height: TERMINAL_SIZE };
            } else {
                cardNodes.push(node);
                html += cardHtml(node);
            }
        }
        for (var k = 0; k < payload.edges.length; k++) {
            var edge = payload.edges[k];
            if (edge.label) {
                labelEdges.push(edge);
                html += '<span class="measure-label">' + escapeHtml(edge.label) + '</span>';
            }
        }

        measureEl.innerHTML = html;
        var els = measureEl.children;
        var idx = 0;
        for (var c = 0; c < cardNodes.length; c++) {
            var rect = els[idx++].getBoundingClientRect();
            nodeSizes[cardNodes[c].id] = { width: Math.ceil(rect.width) + 1, height: Math.ceil(rect.height) + 1 };
        }
        for (var e = 0; e < labelEdges.length; e++) {
            var lw = els[idx++].getBoundingClientRect().width;
            labelSizes[labelEdges[e].id] = { width: Math.ceil(lw) + 12, height: 18 };
        }
        measureEl.innerHTML = '';

        measuredSizes = { nodes: nodeSizes, labels: labelSizes };
        measuredFor = payload;
        return measuredSizes;
    }

    // ---- ELK layout --------------------------------------------------------

    function buildElkGraph(payload, sizes) {
        var dir = payload.direction === 'LR' ? 'RIGHT' : 'DOWN';
        var children = payload.nodes.map(function (n) {
            var child = { id: n.id, width: sizes.nodes[n.id].width, height: sizes.nodes[n.id].height };
            // Pin terminals so the flow reads start -> ... -> end. Without this,
            // a high-in-degree entry step (e.g. mind-reader's 'ask', the target of
            // every loop-back) sinks to the bottom layer and the start marker is
            // dragged down with it, looking disconnected.
            if (n.kind === 'start') {
                child.layoutOptions = { 'elk.layered.layering.layerConstraint': 'FIRST_SEPARATE' };
            } else if (n.kind === 'end') {
                child.layoutOptions = { 'elk.layered.layering.layerConstraint': 'LAST_SEPARATE' };
            }
            return child;
        });
        var edges = payload.edges.map(function (e) {
            var elkEdge = { id: e.id, sources: [e.from], targets: [e.to] };
            if (e.label) {
                var ls = sizes.labels[e.id] || { width: 0, height: 18 };
                elkEdge.labels = [{ id: e.id + '_l', text: e.label, width: ls.width, height: ls.height }];
            }
            return elkEdge;
        });
        return {
            id: 'root',
            layoutOptions: {
                'elk.algorithm': 'layered',
                'elk.direction': dir,
                'elk.edgeRouting': 'ORTHOGONAL',
                // Tighter spacing -> less eye travel on small graphs
                'elk.layered.spacing.nodeNodeBetweenLayers': '48',
                'elk.spacing.nodeNode': '32',
                'elk.spacing.edgeNode': '18',
                'elk.spacing.edgeEdge': '12',
                'elk.layered.spacing.edgeNodeBetweenLayers': '18',
                // Place branch labels next to the node they fan out from (not mid-edge)
                'elk.edgeLabels.placement': 'TAIL',
                'elk.spacing.edgeLabel': '4',
                'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
                // Parallel edges are already grouped in the payload, so don't bundle here.
                'elk.layered.mergeEdges': 'false',
                // Cleaner back-edge routing + tighter alignment for cyclic graphs.
                'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
                'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
                'elk.padding': '[top=20,left=20,bottom=20,right=20]'
            },
            children: children,
            edges: edges
        };
    }

    // ---- Pass 2: render SVG ------------------------------------------------

    function svgEl(name, attrs) {
        var el = document.createElementNS(SVG_NS, name);
        if (attrs) { for (var k in attrs) { el.setAttribute(k, attrs[k]); } }
        return el;
    }

    function renderTerminal(group, node) {
        var cx = TERMINAL_SIZE / 2;
        var cy = TERMINAL_SIZE / 2;
        if (node.kind === 'start') {
            group.appendChild(svgEl('circle', { class: 'terminal-dot', cx: cx, cy: cy, r: 6 }));
        } else {
            group.appendChild(svgEl('circle', { class: 'terminal-outer', cx: cx, cy: cy, r: 8 }));
            group.appendChild(svgEl('circle', { class: 'terminal-dot', cx: cx, cy: cy, r: 4 }));
        }
        // 'start' label sits ABOVE the dot (nothing is above it) so it never
        // overlaps the outgoing edge; 'end' label sits below the dot.
        var labelY = node.kind === 'start' ? -5 : TERMINAL_SIZE + 11;
        var label = svgEl('text', { class: 'terminal-label', x: cx, y: labelY });
        label.textContent = node.kind === 'start' ? 'start' : 'end';
        group.appendChild(label);
    }

    function renderNodeCard(group, node, w, h) {
        var fo = svgEl('foreignObject', { width: w, height: h, class: 'node-fo' });
        var holder = document.createElementNS(XHTML_NS, 'div');
        holder.setAttribute('xmlns', XHTML_NS);
        holder.style.width = '100%';
        holder.style.height = '100%';
        holder.innerHTML = cardHtml(node);
        fo.appendChild(holder);
        group.appendChild(fo);
        var card = holder.firstChild;
        card.addEventListener('click', function () {
            vscodeApi.postMessage({ type: 'navigate', stepId: node.id });
        });
        // Hover-intent: peek at what this step saw/produced (if it has run).
        card.addEventListener('mouseenter', function () { scheduleInspectionShow(node.id, card); });
        card.addEventListener('mouseleave', scheduleInspectionHide);
    }

    function pointToward(from, to, dist) {
        var dx = to.x - from.x, dy = to.y - from.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var t = Math.min(dist, len / 2) / len;
        return { x: from.x + dx * t, y: from.y + dy * t };
    }

    function edgePath(section) {
        var pts = [section.startPoint];
        if (section.bendPoints) { pts = pts.concat(section.bendPoints); }
        pts.push(section.endPoint);
        if (pts.length < 3) {
            return 'M ' + pts[0].x + ' ' + pts[0].y + ' L ' + pts[pts.length - 1].x + ' ' + pts[pts.length - 1].y;
        }
        // Rounded orthogonal corners: line up to R before each bend, then a quadratic
        // through the corner — softer than sharp right angles, less "circuit board".
        var R = 7;
        var d = 'M ' + pts[0].x + ' ' + pts[0].y;
        for (var i = 1; i < pts.length - 1; i++) {
            var before = pointToward(pts[i], pts[i - 1], R);
            var after = pointToward(pts[i], pts[i + 1], R);
            d += ' L ' + before.x + ' ' + before.y + ' Q ' + pts[i].x + ' ' + pts[i].y + ' ' + after.x + ' ' + after.y;
        }
        var last = pts[pts.length - 1];
        d += ' L ' + last.x + ' ' + last.y;
        return d;
    }

    function render(layout, payload) {
        while (svg.firstChild) { svg.removeChild(svg.firstChild); }
        nodeEls = {};
        edgePathsByFromTo = {};
        lastActiveStep = null;
        flowingPaths = [];

        var width = Math.ceil(layout.width || 0);
        var height = Math.ceil(layout.height || 0);
        svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);

        // Arrowhead marker
        var defs = svgEl('defs');
        var marker = svgEl('marker', {
            id: 'arrow', viewBox: '0 0 10 10', refX: '9', refY: '5',
            markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse'
        });
        marker.appendChild(svgEl('path', { class: 'edge-arrow', d: 'M 0 0 L 10 5 L 0 10 z' }));
        defs.appendChild(marker);
        svg.appendChild(defs);

        // Build both layers detached, then attach once (below) so the per-node /
        // per-edge appends don't each mutate the live render tree.
        var edgeLayer = svgEl('g', { class: 'edges' });
        var nodeLayer = svgEl('g', { class: 'nodes' });

        var nodeById = {};
        for (var i = 0; i < payload.nodes.length; i++) { nodeById[payload.nodes[i].id] = payload.nodes[i]; }
        var edgeById = {};
        for (var j = 0; j < payload.edges.length; j++) { edgeById[payload.edges[j].id] = payload.edges[j]; }

        // Edges
        (layout.edges || []).forEach(function (e) {
            var meta = edgeById[e.id] || { kind: 'sequential', from: '', to: '' };
            (e.sections || []).forEach(function (section) {
                var path = svgEl('path', { class: 'edge-path kind-' + meta.kind, d: edgePath(section), 'marker-end': 'url(#arrow)' });
                edgeLayer.appendChild(path);
                addEdgePath(meta.from, meta.to, path);
            });
            // Edge label chip
            if (e.labels && e.labels.length) {
                e.labels.forEach(function (lbl) {
                    var lg = svgEl('g', { class: 'edge-label' });
                    lg.appendChild(svgEl('rect', { class: 'edge-label-bg', x: lbl.x, y: lbl.y, width: lbl.width, height: lbl.height }));
                    var t = svgEl('text', { class: 'edge-label-text', x: lbl.x + lbl.width / 2, y: lbl.y + lbl.height / 2 });
                    t.textContent = lbl.text;
                    lg.appendChild(t);
                    edgeLayer.appendChild(lg);
                });
            }
        });

        // Nodes
        (layout.children || []).forEach(function (c) {
            var node = nodeById[c.id];
            if (!node) return;
            var group = svgEl('g', { class: 'node', 'data-node-id': c.id, transform: 'translate(' + c.x + ',' + c.y + ')' });
            if (isTerminal(node)) {
                renderTerminal(group, node);
            } else {
                renderNodeCard(group, node, c.width, c.height);
            }
            nodeLayer.appendChild(group);
            nodeEls[c.id] = group;
        });

        // Edges below nodes; both attached now in one shot.
        svg.appendChild(edgeLayer);
        svg.appendChild(nodeLayer);
    }

    // ---- Pan / zoom --------------------------------------------------------

    function updateZoomDisplay() {
        if (panZoom) { zoomLevelEl.textContent = Math.round(panZoom.getZoom() * 100) + '%'; }
    }

    function setupPanZoom(hadState) {
        if (panZoom) { panZoom.destroy(); panZoom = null; }
        panZoom = svgPanZoom(svg, {
            zoomEnabled: true, panEnabled: true, controlIconsEnabled: false,
            dblClickZoomEnabled: true, mouseWheelZoomEnabled: true,
            zoomScaleSensitivity: 0.3, minZoom: 0.1, maxZoom: 8,
            fit: false, center: false,
            onZoom: function () { updateZoomDisplay(); saveState(); },
            onPan: function () { saveState(); }
        });
        if (hadState) {
            panZoom.zoom(savedState.zoom || 1);
            panZoom.pan({ x: savedState.panX || 0, y: savedState.panY || 0 });
        } else {
            panZoom.resize(); panZoom.fit(); panZoom.center();
        }
        updateZoomDisplay();
    }

    function panToNode(id) {
        if (!panZoom || !nodeEls[id]) return;
        var bbox = nodeEls[id].getBBox();
        var sizes = panZoom.getSizes();
        var cx = (bbox.x + bbox.width / 2) * sizes.realZoom;
        var cy = (bbox.y + bbox.height / 2) * sizes.realZoom;
        panZoom.pan({ x: sizes.width / 2 - cx, y: sizes.height / 2 - cy });
    }

    // ---- Layout pipeline ---------------------------------------------------

    function layoutAndRender(payload, hadState) {
        currentPayload = payload;
        var sizes = measureGraph(payload);
        var elkGraph = buildElkGraph(payload, sizes);
        return elk.layout(elkGraph).then(function (result) {
            render(result, payload);
            setupPanZoom(hadState);
            hide(loadingEl);
        }).catch(function (err) {
            hide(loadingEl);
            errorEl.textContent = 'Layout failed: ' + (err && err.message ? err.message : String(err));
            show(errorEl);
        });
    }

    // ---- Live execution highlighting ---------------------------------------

    var STATUS_CLASSES = ['node-pending', 'node-active', 'node-completed', 'node-error', 'node-skipped', 'node-awaiting-input'];
    var TERMINAL_CLASSES = ['terminal-active', 'terminal-completed'];

    function addEdgePath(from, to, path) {
        var byTo = edgePathsByFromTo[from] || (edgePathsByFromTo[from] = {});
        (byTo[to] || (byTo[to] = [])).push(path);
    }
    function getEdgePaths(from, to) {
        return (edgePathsByFromTo[from] && edgePathsByFromTo[from][to]) || null;
    }
    function clearEdgeTrail() {
        for (var f in edgePathsByFromTo) {
            for (var t in edgePathsByFromTo[f]) {
                edgePathsByFromTo[f][t].forEach(function (p) { p.classList.remove('edge-flowing', 'edge-traversed'); });
            }
        }
        flowingPaths = [];
        lastActiveStep = null;
    }
    // Promote the (from -> to) edge to "flowing"; demote the previous one to a static trail.
    function markEdgeFlowing(from, to) {
        flowingPaths.forEach(function (p) { p.classList.remove('edge-flowing'); p.classList.add('edge-traversed'); });
        flowingPaths = [];
        var paths = getEdgePaths(from, to);
        if (!paths) { return; }  // e.g. a skipped-guard jump with no direct edge
        paths.forEach(function (p) { p.classList.remove('edge-traversed'); p.classList.add('edge-flowing'); });
        flowingPaths = paths;
    }

    function setNodeStatus(stepId, status) {
        var g = nodeEls[stepId];
        if (!g) return;
        STATUS_CLASSES.forEach(function (c) { g.classList.remove(c); });
        if (status) { g.classList.add('node-' + status); }
        if (status === 'active') {
            // Infer the transition that just ran: previous-active -> this node.
            var from = lastActiveStep || '__start__';
            if (from !== stepId) { markEdgeFlowing(from, stepId); }
            lastActiveStep = stepId;
            if (followActive) { panToNode(stepId); }
        }
    }

    function setTerminalStatus(terminal, status) {
        var id = terminal === 'start' ? '__start__' : '__end__';
        var g = nodeEls[id];
        if (!g) return;
        g.classList.remove.apply(g.classList, TERMINAL_CLASSES);
        if (status === 'active') { g.classList.add('terminal-active'); }
        else if (status === 'completed') { g.classList.add('terminal-completed'); }
        // Flow the final transition into the end terminal.
        if (id === '__end__' && lastActiveStep && (status === 'active' || status === 'completed')) {
            markEdgeFlowing(lastActiveStep, '__end__');
        }
    }

    function resetHighlights() {
        var all = STATUS_CLASSES.concat(TERMINAL_CLASSES);
        for (var id in nodeEls) {
            nodeEls[id].classList.remove.apply(nodeEls[id].classList, all);
        }
        clearEdgeTrail();
    }

    function setModelOverride(model) {
        var banner = document.getElementById('model-override-banner');
        if (model) {
            document.getElementById('model-override-name').textContent = model;
            show(banner);
        } else {
            hide(banner);
        }
    }

    function updateStepModel(stepId, model) {
        var g = nodeEls[stepId];
        if (!g) return;
        var badge = g.querySelector('[data-model-badge]');
        if (badge) { badge.textContent = '🧠 ' + model; }
    }

    // ---- Inspection popover (hover an executed node to inspect prompt/response) ---

    function formatMs(ms) {
        return ms < 1000 ? (ms + 'ms') : ((ms / 1000).toFixed(1) + 's');
    }

    // Cap popover text; the full content is available via "Open ↗".
    function clipText(text) {
        var MAX = 4000;
        return text.length > MAX ? (text.slice(0, MAX) + ' … [truncated — use Open ↗ for full text]') : text;
    }

    function inspectionMetaLine(data) {
        var parts = [];
        if (data.modelUsed) { parts.push('🧠 ' + escapeHtml(data.modelUsed)); }
        parts.push('⏱ ' + formatMs(data.durationMs));
        if (data.toolsUsed && data.toolsUsed.length) { parts.push('🔧 ' + escapeHtml(data.toolsUsed.join(', '))); }
        parts.push(data.status === 'error' ? '⚠ error' : '✓ ' + escapeHtml(data.kind));
        return parts.join('  ·  ');
    }

    // Anchor the popover to a card, preferring its right side; clamp to viewport.
    function positionInspectionPopover(card) {
        var rect = card.getBoundingClientRect();
        var pw = popoverEl.offsetWidth || 340;
        var ph = popoverEl.offsetHeight || 200;
        var gap = 8;
        var left = rect.right + gap;
        if (left + pw > window.innerWidth - gap) { left = rect.left - pw - gap; }
        if (left < gap) { left = gap; }
        var top = rect.top;
        if (top + ph > window.innerHeight - gap) { top = Math.max(gap, window.innerHeight - ph - gap); }
        popoverEl.style.left = left + 'px';
        popoverEl.style.top = top + 'px';
    }

    function showInspectionPopover(stepId, data, card) {
        var html = '<div class="popover-head">';
        html += '<span class="popover-meta">' + inspectionMetaLine(data) + '</span>';
        html += '<span class="popover-actions">';
        html += '<button class="popover-btn" data-act="open" title="Open as a read-only document">Open ↗</button>';
        html += '<button class="popover-btn" data-act="copy" title="Copy the prompt to the clipboard">Copy</button>';
        html += '</span></div>';
        if (data.status === 'error') {
            html += '<div class="popover-section">Error</div>';
            html += '<pre class="popover-pre popover-error">' + (data.error ? escapeHtml(clipText(data.error)) : '(no error message)') + '</pre>';
        }
        html += '<div class="popover-section">Prompt</div>';
        html += '<pre class="popover-pre">' + escapeHtml(clipText(data.prompt)) + '</pre>';
        if (data.kind === 'llm') {
            html += '<div class="popover-section">Response</div>';
            html += '<pre class="popover-pre">' + (data.response ? escapeHtml(clipText(data.response)) : '(no response text)') + '</pre>';
        }
        popoverEl.innerHTML = html;
        popoverEl.querySelector('[data-act="open"]').addEventListener('click', function () {
            vscodeApi.postMessage({ type: 'openStepInspection', stepId: stepId });
        });
        popoverEl.querySelector('[data-act="copy"]').addEventListener('click', function () {
            vscodeApi.postMessage({ type: 'copyStepInspection', stepId: stepId });
        });
        // Reveal before positioning so offset dimensions are measurable; both run
        // synchronously before paint, so there's no visible reposition flicker.
        popoverEl.classList.remove('is-hidden');
        positionInspectionPopover(card);
    }

    function hideInspectionPopover() {
        clearTimeout(hoverShowTimer);   // cancel a pending show so it can't fire after a hide
        clearTimeout(hoverHideTimer);
        popoverEl.classList.add('is-hidden');
        popoverPending = null;
        popoverAnchor = null;   // drop the (possibly detached after re-render) card ref
    }

    // Distinguish "executed but not inspectable" (e.g. a tool step) from "not run yet".
    function nodeHasRun(stepId) {
        var g = nodeEls[stepId];
        return !!g && (g.classList.contains('node-completed') || g.classList.contains('node-error') || g.classList.contains('node-skipped'));
    }

    // Minimal popover for an executed node that has no captured prompt/response.
    function showNoInspectionPopover(card) {
        popoverEl.innerHTML = '<div class="popover-empty">No prompt or response captured for this step type.</div>';
        popoverEl.classList.remove('is-hidden');
        positionInspectionPopover(card);
    }

    // Hover-intent show: after a delay, lazily pull the step's captured I/O.
    function scheduleInspectionShow(stepId, card) {
        clearTimeout(hoverHideTimer);
        clearTimeout(hoverShowTimer);
        hoverStepId = stepId;
        hoverShowTimer = setTimeout(function () {
            if (hoverStepId !== stepId) { return; }
            popoverPending = stepId;
            popoverAnchor = card;
            vscodeApi.postMessage({ type: 'requestStepInspection', stepId: stepId });
        }, HOVER_SHOW_DELAY);
    }

    // Grace period before hiding, so the cursor can travel into the popover.
    function scheduleInspectionHide() {
        clearTimeout(hoverShowTimer);
        hoverShowTimer = null;
        hoverStepId = null;
        hoverHideTimer = setTimeout(hideInspectionPopover, HOVER_HIDE_DELAY);
    }

    // ---- Messages ----------------------------------------------------------

    window.addEventListener('message', function (event) {
        var msg = event.data;
        if (!msg || !msg.type) return;
        switch (msg.type) {
            case 'updateGraph':
                // A re-render orphans the hovered card; drop any open popover.
                hideInspectionPopover();
                // Preserve the user's toolbar direction choice across live-reloads.
                if (msg.payload) { msg.payload.direction = currentPayload.direction; }
                layoutAndRender(msg.payload, false);
                break;
            case 'highlightStep': setNodeStatus(msg.stepId, msg.status); break;
            case 'highlightTerminal': setTerminalStatus(msg.terminal, msg.status); break;
            case 'resetHighlights': resetHighlights(); hideInspectionPopover(); break;
            case 'setModelOverride': setModelOverride(msg.model); break;
            case 'updateStepModel': updateStepModel(msg.stepId, msg.model); break;
            case 'stepInspection':
                // Lazy-pull response: only act if the cursor is still on the node
                // we requested for (guards rapid hover changes).
                if (msg.stepId === popoverPending && hoverStepId === msg.stepId && popoverAnchor) {
                    if (msg.data) { showInspectionPopover(msg.stepId, msg.data, popoverAnchor); }
                    else if (nodeHasRun(msg.stepId)) { showNoInspectionPopover(popoverAnchor); }
                    else { hideInspectionPopover(); }
                }
                // Only clear the slot for the request this response answers, so a
                // late/out-of-order response can't drop a newer pending request.
                if (msg.stepId === popoverPending) { popoverPending = null; }
                break;
            case 'error':
                errorEl.textContent = (msg.title ? msg.title + ': ' : '') + (msg.message || '');
                show(errorEl);
                break;
            case 'warning': showWarning(msg.title, msg.message, msg.count); break;
            case 'clearError': hide(errorEl); hide(warningEl); break;
            default: break;
        }
    });

    // ---- Toolbar -----------------------------------------------------------

    document.getElementById('zoom-in').addEventListener('click', function () { if (panZoom) { panZoom.zoomIn(); } });
    document.getElementById('zoom-out').addEventListener('click', function () { if (panZoom) { panZoom.zoomOut(); } });
    document.getElementById('fit').addEventListener('click', function () {
        if (panZoom) { panZoom.resize(); panZoom.fit(); panZoom.center(); updateZoomDisplay(); saveState(); }
    });
    warningHeaderEl.addEventListener('click', function () {
        warningsCollapsed = warningBodyEl.classList.toggle('is-collapsed');
        warningToggleEl.textContent = warningsCollapsed ? '▸' : '▾';
        saveState();
    });
    followBtn.addEventListener('click', function () {
        followActive = !followActive;
        followBtn.classList.toggle('is-active', followActive);
        saveState();
    });
    dirBtn.addEventListener('click', function () {
        currentPayload.direction = currentPayload.direction === 'LR' ? 'TD' : 'LR';
        updateDirButton();
        saveState();
        layoutAndRender(currentPayload, false);
    });

    // Keep the popover open while the cursor is over it (so its buttons are
    // clickable), and let Escape dismiss it.
    popoverEl.addEventListener('mouseenter', function () { clearTimeout(hoverHideTimer); });
    popoverEl.addEventListener('mouseleave', scheduleInspectionHide);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hideInspectionPopover(); } });

    // ---- Boot --------------------------------------------------------------

    updateDirButton();
    var hadState = savedState && typeof savedState.panX === 'number' && (savedState.panX !== 0 || savedState.panY !== 0 || savedState.zoom !== 1);
    layoutAndRender(currentPayload, hadState).then(function () {
        vscodeApi.postMessage({ type: 'ready' });
    });
})();
`;
