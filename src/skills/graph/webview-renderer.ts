/**
 * Webview Renderer
 *
 * Displays a skill graph in a VSCode WebviewPanel using Mermaid.js.
 * Handles security (CSP, nonces) and theming.
 *
 * Uses bundled assets (mermaid.min.js, svg-pan-zoom.min.js) from media/
 * instead of CDN for offline support and stricter CSP.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';

import type { NodeMetadata } from './types';

/**
 * Options for the webview panel
 */
export interface WebviewOptions {
    /** Column to show the panel in */
    column?: vscode.ViewColumn;
    /** Whether to preserve focus on the current editor */
    preserveFocus?: boolean;
    /** Mapping of escaped IDs to original IDs (for click navigation) */
    idMapping?: Record<string, string>;
    /** Metadata for each node (for badge rendering) */
    nodeMetadata?: Record<string, NodeMetadata>;
}

/**
 * Renders a Mermaid graph in a VSCode WebviewPanel
 *
 * Uses bundled JS assets for:
 * - Offline support (no network dependency)
 * - Corporate firewall compatibility
 * - Stricter CSP (no external domains)
 * - Deterministic versions (locked in package.json)
 */
export class WebviewRenderer {
    private static readonly VIEW_TYPE = 'skillGraph';

    /**
     * Create a WebviewRenderer
     *
     * @param extensionUri - Extension URI for resolving bundled assets
     */
    constructor(private readonly extensionUri: vscode.Uri) {}

    /**
     * Get URI for a bundled script in media/
     */
    private getMediaUri(webview: vscode.Webview, filename: string): vscode.Uri {
        return webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', filename)
        );
    }

    /**
     * Show a skill graph in a webview panel
     *
     * @param title - Panel title (skill name)
     * @param mermaidCode - Mermaid syntax to render
     * @param options - Display options
     * @returns The created WebviewPanel
     */
    show(
        title: string,
        mermaidCode: string,
        options: WebviewOptions = {}
    ): vscode.WebviewPanel {
        const column = options.column ?? vscode.ViewColumn.Beside;

        const panel = vscode.window.createWebviewPanel(
            WebviewRenderer.VIEW_TYPE,
            `Graph: ${title}`,
            { viewColumn: column, preserveFocus: options.preserveFocus ?? true },
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                // Allow access to media folder for bundled scripts
                localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
            }
        );

        panel.webview.html = this.getHtml(mermaidCode, panel.webview, options.idMapping, options.nodeMetadata);

        return panel;
    }

    /**
     * Generate the HTML content for the webview
     */
    private getHtml(
        mermaidCode: string,
        webview: vscode.Webview,
        idMapping: Record<string, string> = {},
        nodeMetadata: Record<string, NodeMetadata> = {}
    ): string {
        const nonce = this.getNonce();
        const theme = this.getMermaidTheme();

        const initialStateJson = this.toWebviewScriptJson({
            mermaidCode,
            idMapping,
            nodeMetadata
        });

        // Get URIs for bundled scripts
        const mermaidUri = this.getMediaUri(webview, 'mermaid.min.js');
        const panZoomUri = this.getMediaUri(webview, 'svg-pan-zoom.min.js');

        // Strict CSP: no remote content; only allow scripts/styles we nonce.
        const csp = [
            `default-src 'none'`,
            `script-src ${webview.cspSource} 'nonce-${nonce}'`,
            // Mermaid/SVG output relies on inline styles in generated markup.
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `img-src ${webview.cspSource} data:`
        ].join('; ');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <title>Skill Graph</title>
    <style nonce="${nonce}">
        :root {
            --graph-tool: var(--vscode-charts-blue);
            --graph-llm: var(--vscode-charts-green);
            --graph-confirm: var(--vscode-charts-orange);
            --graph-error: var(--vscode-charts-red);
            --graph-terminal: var(--vscode-charts-blue);
        }

        .is-hidden { display: none !important; }

        /* Use class instead of inline styles for cursor/visibility */
        .is-clickable { cursor: pointer !important; }

        body {
            margin: 0;
            padding: 16px;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
            display: flex;
            flex-direction: column;
            height: 100vh;
            box-sizing: border-box;
        }

        .toolbar {
            display: flex;
            gap: 6px;
            margin-bottom: 16px;
            align-items: center;
            flex-shrink: 0;
        }

        .toolbar button {
            padding: 4px 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }

        .toolbar button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .toolbar .zoom-level {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            min-width: 50px;
        }

        .graph-wrapper {
            overflow: hidden;
            flex: 1;
            position: relative;
        }

        .mermaid {
            width: 100%;
            height: 100%;
        }

        .mermaid svg {
            max-width: none !important;
            width: 100%;
            height: 100%;
            cursor: grab;
        }

        .mermaid svg:active {
            cursor: grabbing;
        }

        /* Clickable nodes */
        .mermaid .node {
            cursor: pointer;
        }

        .mermaid .node:hover rect,
        .mermaid .node:hover circle,
        .mermaid .node:hover polygon {
            filter: brightness(1.1);
        }

        /* Smaller font for transition labels */
        .mermaid .transition tspan,
        .mermaid .edgeLabel tspan,
        .mermaid text.transitionLabel {
            font-size: 11px !important;
        }

        /* Muted style for tool lines (tspans after the first) */
        .mermaid g.stateDiagram-state text tspan:not(:first-child),
        .mermaid g.node text tspan:not(:first-child),
        .mermaid g[id^="state-"] text tspan:not(:first-child) {
            fill: var(--vscode-descriptionForeground) !important;
        }

        .error {
            color: var(--vscode-errorForeground);
            background: var(--vscode-inputValidation-errorBackground);
            padding: 16px;
            border-radius: 4px;
            margin: 16px 0;
        }

        .loading {
            color: var(--vscode-descriptionForeground);
            padding: 32px;
        }

        .debug {
            margin-top: 16px;
            padding: 8px 12px;
            background: var(--vscode-textBlockQuote-background);
            border-radius: 4px;
            font-size: 11px;
            flex-shrink: 0;
        }

        .debug summary {
            cursor: pointer;
            color: var(--vscode-descriptionForeground);
        }

        .debug pre {
            margin: 8px 0 0 0;
            white-space: pre-wrap;
            word-break: break-all;
            max-height: 150px;
            overflow: auto;
        }

        /* Model Override Banner */
        .model-override-banner {
            position: absolute;
            top: 12px;
            left: 50%;
            transform: translateX(-50%);
            background: color-mix(in srgb, var(--vscode-charts-orange) 15%, var(--vscode-editor-background));
            border: 1px solid var(--vscode-charts-orange);
            border-radius: 6px;
            padding: 8px 16px;
            font-size: 12px;
            z-index: 20;
            display: none;
            align-items: center;
            gap: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        }

        .model-override-banner.is-visible {
            display: flex;
        }

        .model-override-banner__icon {
            font-size: 14px;
        }

        .model-override-banner__text {
            color: var(--vscode-foreground);
        }

        .model-override-banner__model {
            font-weight: 600;
            color: var(--vscode-charts-orange);
        }

        /* Runtime model badge (different from config badge) */
        .card-badge-model--runtime {
            border-color: var(--graph-llm);
            border-width: 2px;
        }

        .card-badge-model--override {
            background: color-mix(in srgb, var(--vscode-charts-orange) 20%, var(--vscode-badge-background));
            border-color: var(--vscode-charts-orange);
        }

        /* Legend */
        .legend {
            position: absolute;
            bottom: 16px;
            right: 16px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 8px 12px;
            font-size: 11px;
            z-index: 10;
            opacity: 0.95;
        }

        .legend-title {
            font-weight: 600;
            margin-bottom: 6px;
            color: var(--vscode-foreground);
        }

        .legend-title--spaced {
            margin-top: 8px;
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 4px 0;
        }

        .legend-color {
            width: 14px;
            height: 14px;
            border-radius: 2px;
            flex-shrink: 0;
            background: transparent;
            border: 2px solid;
        }

        .legend-color.tool { border-color: var(--graph-tool); }
        .legend-color.llm { border-color: var(--graph-llm); }
        .legend-color.confirm { border-color: var(--graph-confirm); }

        .legend-label {
            color: var(--vscode-descriptionForeground);
        }

        .node-foreign-object {
            overflow: visible;
            pointer-events: none;
        }

        /* ===========================================
           CARD UI - foreignObject HTML Cards
           Transform Mermaid nodes into rich cards
           =========================================== */

        /* Card container inside foreignObject */
        .node-card {
            display: flex;
            flex-direction: column;
            width: 100%;
            padding: 6px 10px;
            box-sizing: border-box;
            font-family: var(--vscode-font-family);
            overflow: visible;
            border-radius: 4px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid transparent;
            border-left-width: 4px;
        }

        .node-card.node-card--tool { border-color: var(--graph-tool); }
        .node-card.node-card--llm { border-color: var(--graph-llm); }
        .node-card.node-card--confirmation { border-color: var(--graph-confirm); border-style: dashed; }

        /* Header: Step ID (monospace, dimmed) */
        .card-header {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* Body: Description (main content, bold) */
        .card-body {
            flex: 1;
            font-size: 12px;
            font-weight: 500;
            color: var(--vscode-editor-foreground);
            line-height: 1.4;
            overflow: visible;
            display: block;
            white-space: normal;
            word-break: break-word;
        }

        /* Footer: Badges */
        .card-footer {
            display: flex;
            gap: 3px;
            margin-top: 4px;
            flex-wrap: wrap;
            justify-content: flex-end;
        }

        /* Badge base styles */
        .card-badge {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 9px;
            font-weight: 500;
            line-height: 1;
            white-space: nowrap;
        }

        .card-badge-tool {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border: 1px solid var(--graph-tool);
        }

        .card-badge-model {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border: 1px solid var(--vscode-charts-purple);
        }

        /* Inherited model badge (from skill.models.default) - dashed border, slightly dimmed */
        .card-badge-model--inherited {
            border-style: dashed;
            opacity: 0.85;
        }

        /* Hide rect stroke/fill when card UI is present (card has its own border).
           The rect is kept in DOM for Mermaid arrow anchoring. */
        .mermaid g[id^="state-"].card-type-tool > rect,
        .mermaid g[id^="state-"].card-type-llm > rect,
        .mermaid g[id^="state-"].card-type-confirmation > rect {
            stroke: none !important;
            fill: transparent !important;
        }

        /* Step execution status highlights with type-specific colors */

        /* Glow animations per node type */
        @keyframes glowPulseLlm {
            0%, 100% { filter: drop-shadow(0 0 8px color-mix(in srgb, var(--graph-llm) 60%, transparent)) drop-shadow(0 0 16px color-mix(in srgb, var(--graph-llm) 30%, transparent)); }
            50% { filter: drop-shadow(0 0 12px color-mix(in srgb, var(--graph-llm) 80%, transparent)) drop-shadow(0 0 24px color-mix(in srgb, var(--graph-llm) 50%, transparent)); }
        }
        @keyframes glowPulseTool {
            0%, 100% { filter: drop-shadow(0 0 8px color-mix(in srgb, var(--graph-tool) 60%, transparent)) drop-shadow(0 0 16px color-mix(in srgb, var(--graph-tool) 30%, transparent)); }
            50% { filter: drop-shadow(0 0 12px color-mix(in srgb, var(--graph-tool) 80%, transparent)) drop-shadow(0 0 24px color-mix(in srgb, var(--graph-tool) 50%, transparent)); }
        }
        @keyframes glowPulseConfirm {
            0%, 100% { filter: drop-shadow(0 0 8px color-mix(in srgb, var(--graph-confirm) 60%, transparent)) drop-shadow(0 0 16px color-mix(in srgb, var(--graph-confirm) 30%, transparent)); }
            50% { filter: drop-shadow(0 0 12px color-mix(in srgb, var(--graph-confirm) 80%, transparent)) drop-shadow(0 0 24px color-mix(in srgb, var(--graph-confirm) 50%, transparent)); }
        }

        /* Active step - currently executing with type-specific glow */
        .node-active rect,
        .node-active circle,
        .node-active polygon {
            stroke-width: 3px !important;
        }
        .node-active.card-type-llm rect,
        .node-active.card-type-llm circle,
        .node-active.card-type-llm polygon,
        .node-active.llmStep rect,
        .node-active.llmStep circle,
        .node-active.llmStep polygon { stroke: var(--graph-llm) !important; }
        .node-active.card-type-tool rect,
        .node-active.card-type-tool circle,
        .node-active.card-type-tool polygon,
        .node-active.toolStep rect,
        .node-active.toolStep circle,
        .node-active.toolStep polygon { stroke: var(--graph-tool) !important; }
        .node-active.card-type-confirmation rect,
        .node-active.card-type-confirmation circle,
        .node-active.card-type-confirmation polygon,
        .node-active.confirmStep rect,
        .node-active.confirmStep circle,
        .node-active.confirmStep polygon { stroke: var(--graph-confirm) !important; }

        .node-active.card-type-llm,
        .node-active.llmStep { animation: glowPulseLlm 1.5s ease-in-out infinite; }
        .node-active.card-type-tool,
        .node-active.toolStep { animation: glowPulseTool 1.5s ease-in-out infinite; }
        .node-active.card-type-confirmation,
        .node-active.confirmStep { animation: glowPulseConfirm 1.5s ease-in-out infinite; }

        /* Completed step with type-specific subtle glow */
        .node-completed rect,
        .node-completed circle,
        .node-completed polygon {
            stroke-width: 3px !important;
            fill-opacity: 0.9;
        }
        .node-completed.card-type-llm rect,
        .node-completed.card-type-llm circle,
        .node-completed.card-type-llm polygon,
        .node-completed.llmStep rect,
        .node-completed.llmStep circle,
        .node-completed.llmStep polygon { stroke: var(--graph-llm) !important; }
        .node-completed.card-type-tool rect,
        .node-completed.card-type-tool circle,
        .node-completed.card-type-tool polygon,
        .node-completed.toolStep rect,
        .node-completed.toolStep circle,
        .node-completed.toolStep polygon { stroke: var(--graph-tool) !important; }
        .node-completed.card-type-confirmation rect,
        .node-completed.card-type-confirmation circle,
        .node-completed.card-type-confirmation polygon,
        .node-completed.confirmStep rect,
        .node-completed.confirmStep circle,
        .node-completed.confirmStep polygon { stroke: var(--graph-confirm) !important; }

        .node-completed.card-type-llm,
        .node-completed.llmStep { filter: drop-shadow(0 0 6px color-mix(in srgb, var(--graph-llm) 50%, transparent)) drop-shadow(0 0 12px color-mix(in srgb, var(--graph-llm) 25%, transparent)); }
        .node-completed.card-type-tool,
        .node-completed.toolStep { filter: drop-shadow(0 0 6px color-mix(in srgb, var(--graph-tool) 50%, transparent)) drop-shadow(0 0 12px color-mix(in srgb, var(--graph-tool) 25%, transparent)); }
        .node-completed.card-type-confirmation,
        .node-completed.confirmStep { filter: drop-shadow(0 0 6px color-mix(in srgb, var(--graph-confirm) 50%, transparent)) drop-shadow(0 0 12px color-mix(in srgb, var(--graph-confirm) 25%, transparent)); }

        /* Skipped step */
        .node-skipped rect,
        .node-skipped circle,
        .node-skipped polygon {
            stroke: var(--vscode-disabledForeground) !important;
            stroke-dasharray: 4 2;
            opacity: 0.6;
        }

        /* Error step with red glow */
        .node-error rect,
        .node-error circle,
        .node-error polygon {
            stroke: var(--graph-error) !important;
            stroke-width: 3px !important;
        }
        .node-error {
            filter: drop-shadow(0 0 8px color-mix(in srgb, var(--graph-error) 60%, transparent)) drop-shadow(0 0 16px color-mix(in srgb, var(--graph-error) 30%, transparent));
        }

        /* Pending step (not yet reached) */
        .node-pending rect,
        .node-pending circle,
        .node-pending polygon {
            opacity: 0.5;
        }

        /* Awaiting input step - confirmation paused for user input */
        /* Uses slower pulse to indicate "waiting" vs "processing" */
        @keyframes glowPulseAwaiting {
            0%, 100% { filter: drop-shadow(0 0 8px color-mix(in srgb, var(--graph-confirm) 50%, transparent)) drop-shadow(0 0 16px color-mix(in srgb, var(--graph-confirm) 25%, transparent)); }
            50% { filter: drop-shadow(0 0 14px color-mix(in srgb, var(--graph-confirm) 70%, transparent)) drop-shadow(0 0 28px color-mix(in srgb, var(--graph-confirm) 40%, transparent)); }
        }
        .node-awaiting-input rect,
        .node-awaiting-input circle,
        .node-awaiting-input polygon {
            stroke: var(--graph-confirm) !important;
            stroke-width: 3px !important;
        }
        .node-awaiting-input {
            animation: glowPulseAwaiting 2.5s ease-in-out infinite;
        }

        /* Terminal node (start/end) animations - stronger glow for small circles */
        @keyframes glowPulseTerminal {
            0%, 100% { filter: drop-shadow(0 0 6px var(--graph-terminal)) drop-shadow(0 0 12px var(--graph-terminal)) drop-shadow(0 0 20px color-mix(in srgb, var(--graph-terminal) 60%, transparent)); }
            50% { filter: drop-shadow(0 0 10px var(--graph-terminal)) drop-shadow(0 0 20px var(--graph-terminal)) drop-shadow(0 0 35px color-mix(in srgb, var(--graph-terminal) 80%, transparent)); }
        }

        /* Active terminal - strong pulsing glow */
        .terminal-active {
            animation: glowPulseTerminal 1.5s ease-in-out infinite;
        }

        /* Completed terminal - visible static glow */
        .terminal-completed {
            filter: drop-shadow(0 0 6px var(--graph-terminal)) drop-shadow(0 0 12px color-mix(in srgb, var(--graph-terminal) 50%, transparent));
        }

        /* Parse error banner */
        .parse-error {
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
            color: var(--vscode-errorForeground);
            padding: 8px 12px;
            border-radius: 4px;
            margin-bottom: 12px;
            font-size: 12px;
            font-family: var(--vscode-editor-font-family, monospace);
            white-space: pre-wrap;
            word-break: break-word;
            flex-shrink: 0;
        }

        .parse-error-title {
            font-weight: 600;
            margin-bottom: 4px;
        }

        /* Validation warning banner (collapsible) */
        .parse-warning {
            background: var(--vscode-inputValidation-warningBackground);
            border: 1px solid var(--vscode-inputValidation-warningBorder, #b89500);
            color: var(--vscode-editorWarning-foreground, #cca700);
            padding: 8px 12px;
            border-radius: 4px;
            margin-bottom: 12px;
            font-size: 12px;
            font-family: var(--vscode-editor-font-family, monospace);
            flex-shrink: 0;
        }

        .parse-warning-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            user-select: none;
        }

        .parse-warning-header:hover {
            opacity: 0.9;
        }

        .parse-warning-title {
            font-weight: 600;
        }

        .parse-warning-count {
            font-weight: normal;
            margin-left: 4px;
            opacity: 0.85;
        }

        .parse-warning-toggle {
            background: none;
            border: none;
            color: inherit;
            font-size: 14px;
            cursor: pointer;
            padding: 0 4px;
            opacity: 0.7;
            transition: opacity 0.15s;
        }

        .parse-warning-toggle:hover {
            opacity: 1;
        }

        .parse-warning-body {
            margin-top: 8px;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .parse-warning-body.is-collapsed {
            display: none;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button id="zoom-out">−</button>
        <span id="zoom-level" class="zoom-level">100%</span>
        <button id="zoom-in">+</button>
        <button id="zoom-reset">Reset</button>
    </div>

    <div id="parse-error" class="parse-error is-hidden">
        <div id="parse-error-title" class="parse-error-title"></div>
        <div id="parse-error-message"></div>
    </div>

    <div id="parse-warning" class="parse-warning is-hidden">
        <div class="parse-warning-header" id="warning-header">
            <span>
                <span id="parse-warning-title" class="parse-warning-title"></span>
                <span id="parse-warning-count" class="parse-warning-count"></span>
            </span>
            <button class="parse-warning-toggle" id="warning-toggle" title="Toggle warning details">▾</button>
        </div>
        <div class="parse-warning-body" id="warning-body">
            <div id="parse-warning-message"></div>
        </div>
    </div>

    <div id="loading" class="loading">Loading graph...</div>
    <div id="error" class="error is-hidden"></div>

    <div class="graph-wrapper">
        <div id="model-override-banner" class="model-override-banner">
            <span class="model-override-banner__icon">⚠️</span>
            <span class="model-override-banner__text">Model Override:</span>
            <span id="model-override-name" class="model-override-banner__model"></span>
        </div>
        <pre id="graph" class="mermaid"></pre>
        <div class="legend">
            <div class="legend-title">Step Types</div>
            <div class="legend-item">
                <div class="legend-color tool"></div>
                <span class="legend-label">Tool step</span>
            </div>
            <div class="legend-item">
                <div class="legend-color llm"></div>
                <span class="legend-label">LLM step</span>
            </div>
            <div class="legend-item">
                <div class="legend-color confirm"></div>
                <span class="legend-label">Confirmation</span>
            </div>
        </div>
    </div>

    <details class="debug">
        <summary>Mermaid Code</summary>
        <pre></pre>
    </details>

    <script nonce="${nonce}" src="${mermaidUri}"></script>
    <script nonce="${nonce}" src="${panZoomUri}"></script>
    <script nonce="${nonce}">
        (function() {
            // Acquire VSCode API for messaging
            var vscode = acquireVsCodeApi();

            // Restore previous state (zoom, pan position, warning collapse)
            // This survives tab switches without retainContextWhenHidden
            var savedState = vscode.getState() || { zoom: 1, panX: 0, panY: 0, warningsCollapsed: false };

            function hide(el) { el.classList.add('is-hidden'); }
            function show(el) { el.classList.remove('is-hidden'); }

            var initialState = ${initialStateJson};

            // ID mapping: escaped Mermaid IDs -> original step IDs
            var idMapping = initialState.idMapping || {};

            // Node metadata for badge rendering (keyed by escaped ID)
            var nodeMetadata = initialState.nodeMetadata || {};

            var loadingEl = document.getElementById('loading');
            var errorEl = document.getElementById('error');
            var graphEl = document.getElementById('graph');
            var zoomLevelEl = document.getElementById('zoom-level');
            var parseErrorEl = document.getElementById('parse-error');
            var parseErrorTitleEl = document.getElementById('parse-error-title');
            var parseErrorMsgEl = document.getElementById('parse-error-message');
            var parseWarningEl = document.getElementById('parse-warning');
            var parseWarningTitleEl = document.getElementById('parse-warning-title');
            var parseWarningMsgEl = document.getElementById('parse-warning-message');
            var parseWarningCountEl = document.getElementById('parse-warning-count');
            var warningHeaderEl = document.getElementById('warning-header');
            var warningBodyEl = document.getElementById('warning-body');
            var warningToggleEl = document.getElementById('warning-toggle');

            // Warning panel collapse toggle
            warningHeaderEl.onclick = function() {
                var isCollapsed = warningBodyEl.classList.toggle('is-collapsed');
                warningToggleEl.textContent = isCollapsed ? '▸' : '▾';

                // Persist collapse state
                savedState.warningsCollapsed = isCollapsed;
                vscode.setState(savedState);
            };

            // Initialize content safely (avoid HTML/script injection)
            graphEl.textContent = initialState.mermaidCode || '';
            var initialDebugPre = document.querySelector('.debug pre');
            if (initialDebugPre) {
                initialDebugPre.textContent = initialState.mermaidCode || '';
            }

            // Zoom button handlers (use svg-pan-zoom API)
            document.getElementById('zoom-in').onclick = function() {
                if (panZoomInstance) {
                    panZoomInstance.zoomIn();
                    updateZoomDisplay();
                }
            };

            document.getElementById('zoom-out').onclick = function() {
                if (panZoomInstance) {
                    panZoomInstance.zoomOut();
                    updateZoomDisplay();
                }
            };

            document.getElementById('zoom-reset').onclick = function() {
                if (panZoomInstance) {
                    panZoomInstance.resetZoom();
                    panZoomInstance.resetPan();
                    updateZoomDisplay();
                }
            };

            /**
             * Transform Mermaid nodes into Card UI
             */
            function transformNodesToCards() {
                var svg = graphEl.querySelector('svg');
                if (!svg) return;

                var nodes = svg.querySelectorAll('g[id^="state-"]');

                nodes.forEach(function(node) {
                    var nodeId = node.id || '';
                    if (!nodeId) return;

                    // Extract escaped ID from Mermaid's generated ID (e.g., "state-step_name-0")
                    var escapedId = extractEscapedId(nodeId);
                    if (!escapedId) return;

                    // Get metadata for this node
                    var meta = nodeMetadata[escapedId];
                    if (!meta) return;

                    // Find rect and text elements
                    var rect = node.querySelector('rect');
                    var textEl = node.querySelector('text');
                    if (!rect) return;

                    // Parse multi-line content from tspans
                    // Line 1: Step ID, Line 2: Description
                    var stepId = '';
                    var description = '';

                    if (textEl) {
                        var tspans = textEl.querySelectorAll('tspan');
                        if (tspans.length >= 1) {
                            stepId = tspans[0].textContent ? tspans[0].textContent.trim() : '';
                        }
                        if (tspans.length >= 2) {
                            var rawDesc = tspans[1].textContent ? tspans[1].textContent.trim() : '';
                            // Filter out width placeholder (middle dots · or regular dots . with spaces)
                            description = /^[\.\·\u00B7\s]+$/.test(rawDesc) ? '' : rawDesc;
                        }
                        // Fallback if no tspans
                        if (tspans.length === 0 && textEl.textContent) {
                            stepId = textEl.textContent.trim();
                        }
                        // Hide original text without inline styles (CSP-friendly)
                        textEl.classList.add('is-hidden');
                    }

                    // Fallback to metadata/mapping if parsing failed
                    if (!stepId) {
                        stepId = idMapping[escapedId] || escapedId;
                    }

                    // ============================================
                    // Get rect dimensions - handle centered coords
                    // Mermaid state diagrams may use negative x/y
                    // for centered rects (e.g., x="-50" for 100px width)
                    // ============================================
                    var rectX = parseFloat(rect.getAttribute('x') || '0');
                    var rectY = parseFloat(rect.getAttribute('y') || '0');
                    var rectWidth = parseFloat(rect.getAttribute('width') || '0');
                    var rectHeight = parseFloat(rect.getAttribute('height') || '0');

                    // Apply type-specific border color class to the group
                    if (meta.type === 'tool') {
                        node.classList.add('card-type-tool');
                    } else if (meta.type === 'llm') {
                        node.classList.add('card-type-llm');
                    } else if (meta.type === 'confirmation') {
                        node.classList.add('card-type-confirmation');
                    }

                    // Create foreignObject at rect position (keep rect for arrow anchors)
                    // Height is already reserved via placeholder lines in Mermaid
                    var extraHeight = 0;

                    var fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
                    fo.setAttribute('x', String(rectX));
                    fo.setAttribute('y', String(rectY));
                    fo.setAttribute('width', String(rectWidth));
                    fo.setAttribute('height', String(rectHeight + extraHeight));
                    fo.classList.add('node-foreign-object');

                    var cardTypeClass = '';
                    if (meta.type === 'tool') {
                        cardTypeClass = ' node-card--tool';
                    } else if (meta.type === 'llm') {
                        cardTypeClass = ' node-card--llm';
                    } else if (meta.type === 'confirmation') {
                        cardTypeClass = ' node-card--confirmation';
                    }

                    var cardHtml = '<div xmlns="http://www.w3.org/1999/xhtml" class="node-card' + cardTypeClass + '">';
                    cardHtml += '<div class="card-header">' + escapeHtml(stepId) + '</div>';

                    if (description) {
                        cardHtml += '<div class="card-body">' + escapeHtml(description) + '</div>';
                    }

                    // All badges in card footer (height reserved via Mermaid placeholder lines)
                    var footerParts = [];

                    // Tool badges
                    if (meta.tools && meta.tools.length > 0) {
                        for (var i = 0; i < meta.tools.length; i++) {
                            footerParts.push('<span class="card-badge card-badge-tool">🔧 ' + escapeHtml(meta.tools[i]) + '</span>');
                        }
                    }

                    // Model badge
                    if (meta.model) {
                        var modelBadgeClass = 'card-badge card-badge-model';
                        var modelText = meta.model;
                        if (meta.modelSource === 'inherited') {
                            modelBadgeClass += ' card-badge-model--inherited';
                            modelText += ' (default)';
                        }
                        footerParts.push('<span class="' + modelBadgeClass + '">🧠 ' + escapeHtml(modelText) + '</span>');
                    }

                    if (footerParts.length > 0) {
                        cardHtml += '<div class="card-footer">' + footerParts.join('') + '</div>';
                    }

                    cardHtml += '</div>';

                    fo.innerHTML = cardHtml;
                    node.appendChild(fo);
                });
            }

            /**
             * Extract escaped ID from Mermaid's generated node ID
             * Mermaid generates IDs like "state-step_name-0"
             * We need to extract "step_name"
             */
            function extractEscapedId(nodeId) {
                var withoutPrefix = nodeId.replace(/^state-/, '');
                var lastDashIndex = withoutPrefix.lastIndexOf('-');

                if (lastDashIndex > 0) {
                    var suffix = withoutPrefix.substring(lastDashIndex + 1);
                    // Check if suffix is all digits (Mermaid's index)
                    if (/^\\d+$/.test(suffix)) {
                        return withoutPrefix.substring(0, lastDashIndex);
                    }
                }

                return withoutPrefix;
            }

            /**
             * Escape HTML special characters to prevent XSS
             */
            function escapeHtml(text) {
                var div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            /**
             * Add click handlers to all state nodes after Mermaid renders
             */
            function setupNodeClickHandlers() {
                var svg = graphEl.querySelector('svg');
                if (!svg) return;

                // Mermaid state diagram node selectors
                var nodes = svg.querySelectorAll('g[id^="state-"], g.stateDiagram-state, g.node');

                nodes.forEach(function(node) {
                    var nodeId = node.id || '';

                    // Skip if no ID
                    if (!nodeId) return;

                    // Extract step ID from Mermaid's generated ID
                    // Mermaid stateDiagram generates IDs like "state-stepName-123"
                    // We need to: 1) remove "state-" prefix, 2) remove "-<number>" suffix
                    var withoutPrefix = nodeId.replace(/^state-/, '');

                    // Remove trailing dash followed by digits (Mermaid's index)
                    // Use a more explicit approach to ensure it works
                    var lastDashIndex = withoutPrefix.lastIndexOf('-');
                    var escapedId = withoutPrefix;
                    if (lastDashIndex > 0) {
                        var suffix = withoutPrefix.substring(lastDashIndex + 1);
                        // Check if suffix is all digits
                        if (/^\\d+$/.test(suffix)) {
                            escapedId = withoutPrefix.substring(0, lastDashIndex);
                        }
                    }

                    // Skip empty IDs
                    if (!escapedId) return;

                    // Handle special nodes (start/end)
                    var isStartNode = escapedId === 'root_start' || escapedId.indexOf('start') !== -1 && nodeId.indexOf('root') !== -1;
                    var isEndNode = escapedId === 'root_end' || escapedId.indexOf('end') !== -1 && nodeId.indexOf('root') !== -1;

                    // Skip other special nodes
                    if (escapedId === '[*]' || escapedId === 'root') return;

                    // Determine target for navigation
                    var stepId;
                    if (isStartNode) {
                        stepId = '__inputs__';
                    } else if (isEndNode) {
                        stepId = '__output__';
                    } else {
                        // Look up original ID from mapping, fall back to escaped ID
                        stepId = idMapping[escapedId] || escapedId;
                    }

                    node.classList.add('is-clickable');
                    node.onclick = function(e) {
                        e.stopPropagation();
                        vscode.postMessage({ type: 'navigate', stepId: stepId });
                    };
                });
            }

            // Pan-zoom instance
            var panZoomInstance = null;

            // Track currently active step to clear when new step activates
            var currentActiveStepId = null;

            /**
             * Initialize svg-pan-zoom on the rendered SVG
             */
            function setupPanZoom() {
                var svg = graphEl.querySelector('svg');
                if (!svg) return;

                // Destroy previous instance if exists
                if (panZoomInstance) {
                    panZoomInstance.destroy();
                    panZoomInstance = null;
                }

                // Initialize svg-pan-zoom
                panZoomInstance = svgPanZoom(svg, {
                    zoomEnabled: true,
                    panEnabled: true,
                    controlIconsEnabled: false,
                    dblClickZoomEnabled: true,
                    mouseWheelZoomEnabled: true,
                    preventMouseEventsDefault: false,
                    zoomScaleSensitivity: 0.3,
                    minZoom: 0.25,
                    maxZoom: 5,
                    fit: false,
                    center: false,
                    onZoom: function() {
                        updateZoomDisplay();
                        saveState();
                    },
                    onPan: function() {
                        saveState();
                    }
                });

                // Restore saved zoom/pan state (survives tab switches)
                if (savedState.zoom !== 1) {
                    panZoomInstance.zoom(savedState.zoom);
                }
                if (savedState.panX !== 0 || savedState.panY !== 0) {
                    panZoomInstance.pan({ x: savedState.panX, y: savedState.panY });
                }

                updateZoomDisplay();
            }

            /**
             * Update zoom level display
             */
            function updateZoomDisplay() {
                if (panZoomInstance) {
                    var zoom = panZoomInstance.getZoom();
                    zoomLevelEl.textContent = Math.round(zoom * 100) + '%';
                }
            }

            /**
             * Save current zoom/pan state for persistence across tab switches
             * Uses VSCode's getState/setState API (lower overhead than retainContextWhenHidden)
             */
            function saveState() {
                if (!panZoomInstance) return;
                var pan = panZoomInstance.getPan();
                vscode.setState({
                    zoom: panZoomInstance.getZoom(),
                    panX: pan.x,
                    panY: pan.y
                });
            }

            /**
             * Render Mermaid diagram
             */
            function renderGraph() {
                show(loadingEl);
                hide(errorEl);

                mermaid.run({ nodes: [graphEl] }).then(function() {
                    hide(loadingEl);
                    setupNodeClickHandlers();
                    transformNodesToCards();
                    setupPanZoom();
                    vscode.postMessage({ type: 'ready' });
                }).catch(function(err) {
                    hide(loadingEl);
                    errorEl.textContent = 'Failed to render: ' + (err.message || err);
                    show(errorEl);
                    // Still signal 'ready' so validation diagnostics and execution-state
                    // resync don't get silently dropped when the diagram fails to render.
                    vscode.postMessage({ type: 'ready' });
                });
            }

            /**
             * Find SVG node element by step ID
             */
            function findNodeByStepId(stepId) {
                var svg = graphEl.querySelector('svg');
                if (!svg) return null;

                // Look up escaped ID from mapping (reverse lookup)
                var escapedId = stepId;
                for (var key in idMapping) {
                    if (idMapping[key] === stepId) {
                        escapedId = key;
                        break;
                    }
                }

                // Mermaid generates IDs like "state-stepName-123"
                var nodes = svg.querySelectorAll('g[id^="state-"]');
                for (var i = 0; i < nodes.length; i++) {
                    var node = nodes[i];
                    var nodeId = node.id || '';

                    // Extract step ID from Mermaid's generated ID
                    var withoutPrefix = nodeId.replace(/^state-/, '');
                    var lastDashIndex = withoutPrefix.lastIndexOf('-');
                    var extractedId = withoutPrefix;
                    if (lastDashIndex > 0) {
                        var suffix = withoutPrefix.substring(lastDashIndex + 1);
                        if (/^\\d+$/.test(suffix)) {
                            extractedId = withoutPrefix.substring(0, lastDashIndex);
                        }
                    }

                    if (extractedId === escapedId || extractedId === stepId) {
                        return node;
                    }
                }
                return null;
            }

            /**
             * Highlight a step with the given status
             */
            function highlightStep(stepId, status) {
                // If a step is becoming active or awaiting-input, clear previous active/awaiting nodes
                if (status === 'active' || status === 'awaiting-input') {
                    var svg = graphEl.querySelector('svg');
                    if (svg) {
                        var activeNodes = svg.querySelectorAll('.node-active, .node-awaiting-input');
                        activeNodes.forEach(function(n) {
                            n.classList.remove('node-active', 'node-awaiting-input');
                            n.classList.add('node-completed');
                        });
                    }
                }

                var node = findNodeByStepId(stepId);
                if (!node) return;

                // Remove all status classes
                node.classList.remove('node-pending', 'node-active', 'node-awaiting-input', 'node-completed', 'node-skipped', 'node-error');

                // Add new status class
                node.classList.add('node-' + status);

                // Track current active step
                if (status === 'active') {
                    currentActiveStepId = stepId;
                } else if (stepId === currentActiveStepId) {
                    currentActiveStepId = null;
                }
            }

            /**
             * Reset all step highlights
             */
            function resetAllHighlights() {
                var svg = graphEl.querySelector('svg');
                if (!svg) return;

                var nodes = svg.querySelectorAll('g[id^="state-"]');
                nodes.forEach(function(node) {
                    node.classList.remove('node-pending', 'node-active', 'node-awaiting-input', 'node-completed', 'node-skipped', 'node-error');
                    node.classList.add('node-pending');
                });

                // Reset terminal nodes
                var startNode = findTerminalNode('start');
                var endNode = findTerminalNode('end');
                if (startNode) startNode.classList.remove('terminal-active', 'terminal-completed');
                if (endNode) endNode.classList.remove('terminal-active', 'terminal-completed');

                // Clear active step tracking
                currentActiveStepId = null;
            }

            /**
             * Show or hide model override banner
             */
            function setModelOverrideBanner(model) {
                var banner = document.getElementById('model-override-banner');
                var modelName = document.getElementById('model-override-name');
                if (!banner || !modelName) return;

                if (model) {
                    modelName.textContent = model;
                    banner.classList.add('is-visible');
                } else {
                    banner.classList.remove('is-visible');
                    modelName.textContent = '';
                }
            }

            /**
             * Update a step's model badge with runtime information
             */
            function updateStepModelBadge(stepId, model, source) {
                var svg = graphEl.querySelector('svg');
                if (!svg) return;

                // Find the node by step ID (need to check escaped IDs)
                var escapedId = stepId;
                // Check if we need to look up the escaped ID
                for (var escaped in idMapping) {
                    if (idMapping[escaped] === stepId) {
                        escapedId = escaped;
                        break;
                    }
                }

                // Find all nodes and look for matching ID
                var nodes = svg.querySelectorAll('g[id^="state-"]');
                var targetNode = null;
                nodes.forEach(function(node) {
                    var nodeEscapedId = extractEscapedId(node.id || '');
                    if (nodeEscapedId === escapedId || nodeEscapedId === stepId) {
                        targetNode = node;
                    }
                });

                if (!targetNode) return;

                // Find the model badge in this node's card
                var fo = targetNode.querySelector('.node-foreign-object');
                if (!fo) return;

                var existingBadge = fo.querySelector('.card-badge-model');
                var footer = fo.querySelector('.card-footer');

                // Determine badge class based on source
                var badgeClass = 'card-badge card-badge-model';
                if (source === 'user-override') {
                    badgeClass += ' card-badge-model--override';
                } else {
                    badgeClass += ' card-badge-model--runtime';
                }

                if (existingBadge) {
                    // Update existing badge
                    existingBadge.className = badgeClass;
                    existingBadge.innerHTML = '🧠 ' + escapeHtml(model);
                } else if (footer) {
                    // Add new badge to footer
                    var badge = document.createElement('span');
                    badge.className = badgeClass;
                    badge.innerHTML = '🧠 ' + escapeHtml(model);
                    footer.appendChild(badge);
                } else {
                    // No footer yet, need to create one
                    var card = fo.querySelector('.node-card');
                    if (card) {
                        var newFooter = document.createElement('div');
                        newFooter.className = 'card-footer';
                        var badge = document.createElement('span');
                        badge.className = badgeClass;
                        badge.innerHTML = '🧠 ' + escapeHtml(model);
                        newFooter.appendChild(badge);
                        card.appendChild(newFooter);
                    }
                }
            }

            /**
             * Find terminal node (start or end)
             * Mermaid stateDiagram-v2 renders [*] as marker circles.
             * Start marker: solid filled circle at the beginning
             * End marker: double circle (ring with inner circle) at the end
             */
            function findTerminalNode(terminal) {
                var svg = graphEl.querySelector('svg');
                if (!svg) return null;

                // Get all groups and circles
                var allGroups = svg.querySelectorAll('g');

                // Look for groups that contain ONLY circles (terminal markers)
                // and don't have text elements (state labels)
                var terminalGroups = [];
                for (var i = 0; i < allGroups.length; i++) {
                    var g = allGroups[i];
                    var circles = g.querySelectorAll(':scope > circle');
                    var texts = g.querySelectorAll(':scope > text');
                    var rects = g.querySelectorAll(':scope > rect');

                    // Terminal markers have circle(s) but no text/rect
                    if (circles.length > 0 && texts.length === 0 && rects.length === 0) {
                        // Skip if this is a nested group inside a state
                        var parentId = g.parentElement?.id || '';
                        if (!parentId.startsWith('state-') || parentId.indexOf('root') !== -1) {
                            terminalGroups.push({
                                group: g,
                                circleCount: circles.length,
                                y: parseFloat(circles[0].getAttribute('cy') || '0')
                            });
                        }
                    }
                }

                if (terminalGroups.length === 0) return null;

                // Sort by Y position (for TD direction: lower Y = start, higher Y = end)
                terminalGroups.sort(function(a, b) { return a.y - b.y; });

                if (terminal === 'start') {
                    // Start is at top (lowest Y) - usually has 1 circle
                    return terminalGroups[0]?.group || null;
                } else {
                    // End is at bottom (highest Y) - usually has 2 circles (double ring)
                    return terminalGroups[terminalGroups.length - 1]?.group || null;
                }
            }

            /**
             * Highlight a terminal node with the given status
             */
            function highlightTerminal(terminal, status) {
                var node = findTerminalNode(terminal);
                if (!node) return;

                // Remove status classes
                node.classList.remove('terminal-active', 'terminal-completed');

                // Add new status class (idle = no class)
                if (status !== 'idle') {
                    node.classList.add('terminal-' + status);
                }
            }

            /**
             * Handle messages from extension (for live reload and step highlighting)
             */
            window.addEventListener('message', function(event) {
                var message = event.data;
                // Validate inbound message shape before dispatch (defense-in-depth).
                if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
                    return;
                }
                if (message.type === 'update') {
                    // Clear parse error on successful update
                    hide(parseErrorEl);

                    // Update ID mapping (for click-to-navigate and highlighting)
                    if (message.idMapping) {
                        idMapping = message.idMapping;
                    }

                    // Update node metadata (for badge rendering)
                    if (message.nodeMetadata) {
                        nodeMetadata = message.nodeMetadata;
                    }

                    graphEl.textContent = message.mermaidCode;
                    graphEl.removeAttribute('data-processed');
                    // Update debug section
                    var debugPre = document.querySelector('.debug pre');
                    if (debugPre) {
                        debugPre.textContent = message.mermaidCode;
                    }
                    // Re-render
                    renderGraph();
                } else if (message.type === 'error') {
                    // Show error banner with dynamic title
                    parseErrorTitleEl.textContent = message.title;
                    parseErrorMsgEl.textContent = message.message;
                    show(parseErrorEl);
                } else if (message.type === 'warning') {
                    // Show warning banner (collapsible, doesn't block)
                    parseWarningTitleEl.textContent = message.title;
                    parseWarningCountEl.textContent = '(' + message.count + ')';
                    parseWarningMsgEl.textContent = message.message;
                    show(parseWarningEl);

                    // Restore collapse state from saved state
                    if (savedState.warningsCollapsed) {
                        warningBodyEl.classList.add('is-collapsed');
                        warningToggleEl.textContent = '▸';
                    } else {
                        warningBodyEl.classList.remove('is-collapsed');
                        warningToggleEl.textContent = '▾';
                    }
                } else if (message.type === 'clearError') {
                    // Hide parse error and warning banners
                    hide(parseErrorEl);
                    hide(parseWarningEl);
                } else if (message.type === 'highlightStep') {
                    // Highlight a step during execution
                    highlightStep(message.stepId, message.status);
                } else if (message.type === 'highlightTerminal') {
                    // Highlight start/end terminal during execution
                    highlightTerminal(message.terminal, message.status);
                } else if (message.type === 'resetHighlights') {
                    // Reset all highlights before new execution
                    resetAllHighlights();
                } else if (message.type === 'setModelOverride') {
                    // Show or hide model override banner
                    setModelOverrideBanner(message.model);
                } else if (message.type === 'updateStepModel') {
                    // Update a step's model badge with runtime info
                    updateStepModelBadge(message.stepId, message.model, message.source);
                }
            });

            try {
                mermaid.initialize({
                    startOnLoad: false,
                    theme: '${theme}',
                    securityLevel: 'strict',
                    flowchart: {
                        useMaxWidth: false,
                        htmlLabels: false,
                        curve: 'linear'
                    },
                    state: {
                        useMaxWidth: false
                    },
                    themeVariables: {
                        edgeLabelBackground: 'transparent',
                        fontSize: '14px'
                    }
                });

                // Initial render
                renderGraph();
            } catch (err) {
                hide(loadingEl);
                errorEl.textContent = 'Failed to initialize: ' + (err.message || err);
                show(errorEl);
            }
        })();
    </script>
</body>
</html>`;
    }

    /**
     * Serialize a value into JSON that is safe to embed directly into a <script> tag.
     *
     * This prevents breaking out of the script context via sequences like "</script>".
     */
    private toWebviewScriptJson(value: unknown): string {
        return JSON.stringify(value)
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029');
    }

    /**
     * Generate a cryptographically secure nonce
     */
    private getNonce(): string {
        return crypto.randomBytes(16).toString('base64');
    }

    /**
     * Get the Mermaid theme based on VS Code theme
     */
    private getMermaidTheme(): string {
        const kind = vscode.window.activeColorTheme.kind;

        switch (kind) {
            case vscode.ColorThemeKind.Light:
                return 'default';
            case vscode.ColorThemeKind.Dark:
            case vscode.ColorThemeKind.HighContrast:
            default:
                return 'dark';
        }
    }

}
