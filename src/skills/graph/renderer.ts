/**
 * Graph renderer contract.
 *
 * An engine is a {@link SkillGraph} serializer plus a webview that draws it,
 * behind the {@link GraphRenderer} interface. Callers go through
 * {@link getGraphRenderer} and never reference a concrete engine.
 *
 * To add an engine: implement {@link GraphRenderer} in its own folder under
 * `graph/` (serializer + webview, modelled on `graph/elk/`), add its live-update
 * variant to {@link ExtensionMessage} in types.ts, and add it to `RENDERERS`.
 * `index.ts` and `panel-manager.ts` need no changes.
 */

import * as vscode from 'vscode';

import type { Skill } from '../types';
import type { ExtensionMessage, GraphWebviewOptions, RenderOptions, SkillGraph } from './types';
import { ElkWebviewRenderer } from './elk/elk-webview-renderer';
import { buildElkPayload } from './elk/payload';

/** The contract every graph engine implements. */
export interface GraphRenderer {
    /** Stable engine id (matches its entry in `RENDERERS`). */
    readonly id: string;

    /** First paint: create and show the webview panel for the graph. */
    createPanel(
        skill: Skill,
        graph: SkillGraph,
        extensionUri: vscode.Uri,
        webviewOptions: GraphWebviewOptions,
        renderOptions?: RenderOptions
    ): vscode.WebviewPanel;

    /** Live reload: the message that re-renders the graph in an open panel. */
    buildUpdateMessage(graph: SkillGraph, renderOptions?: RenderOptions): ExtensionMessage;
}

/** Built-in ELK.js + SVG engine. */
class ElkGraphRenderer implements GraphRenderer {
    readonly id = 'elk';

    createPanel(
        skill: Skill,
        graph: SkillGraph,
        extensionUri: vscode.Uri,
        webviewOptions: GraphWebviewOptions,
        renderOptions?: RenderOptions
    ): vscode.WebviewPanel {
        const payload = buildElkPayload(graph, renderOptions);
        return new ElkWebviewRenderer(extensionUri).show(skill.name, payload, webviewOptions);
    }

    buildUpdateMessage(graph: SkillGraph, renderOptions?: RenderOptions): ExtensionMessage {
        return { type: 'updateGraph', payload: buildElkPayload(graph, renderOptions) };
    }
}

/** Registered engines — a new engine adds itself here (one line). */
const RENDERERS: readonly GraphRenderer[] = [new ElkGraphRenderer()];

/** Id of the active engine. Take this from a setting once 2+ engines exist. */
const ACTIVE_ENGINE = 'elk';

/** The active graph engine. */
export function getGraphRenderer(): GraphRenderer {
    return RENDERERS.find(r => r.id === ACTIVE_ENGINE) ?? RENDERERS[0];
}
