/**
 * Graph Types
 *
 * Interfaces for the skill graph visualization system.
 * Designed for extensibility - new renderers can be added without changing core.
 */

import type * as vscode from 'vscode';

import type { StepStatus, TerminalStatus } from '../execution-state';
import type { ModelSource } from '../types';

/**
 * Webview display options for a graph panel (engine-agnostic).
 */
export interface GraphWebviewOptions {
    /** Column to show the panel in. */
    column?: vscode.ViewColumn;
    /** Keep focus on the current editor. */
    preserveFocus?: boolean;
}

/**
 * Node types in the skill graph
 */
export type NodeType = 'llm' | 'tool' | 'confirmation' | 'terminal';

/**
 * Edge types representing different flow transitions
 */
export type EdgeType = 'sequential' | 'conditional' | 'goto' | 'abort';

/**
 * Source of model configuration for a step (static, from YAML)
 *
 * Different from runtime ModelSource which tracks actual resolution.
 * - 'explicit': Step has `model:` defined directly in YAML
 * - 'inherited': Step inherits from skill's `models.default`
 */
export type ConfigModelSource = 'explicit' | 'inherited';

/**
 * A node in the skill graph (represents a step)
 */
export interface GraphNode {
    /** Unique node identifier (matches step id) */
    id: string;
    /** Display label for the node */
    label: string;
    /** Node type determines visual styling */
    type: NodeType;
    /** Optional condition that must be true for this node to execute */
    condition?: string;
    /** Tools available for this step (for tool badges/tooltips) */
    tools?: string[];
    /** Specific tool to invoke (for tool steps) */
    tool?: string;
    /** Model ID or alias for this step (for model badge display) */
    model?: string;
    /** How the model was determined (explicit step config or inherited from skill default) */
    modelSource?: ConfigModelSource;
}

/**
 * An edge in the skill graph (represents flow between steps)
 */
export interface GraphEdge {
    /** Source node id */
    from: string;
    /** Target node id */
    to: string;
    /** Optional edge label (e.g., "Continue", condition text) */
    label?: string;
    /** Edge type determines visual styling */
    type: EdgeType;
}

/**
 * Intermediate graph representation (decoupled from rendering)
 */
export interface SkillGraph {
    /** Graph title (skill name) */
    title: string;
    /** All nodes in the graph */
    nodes: GraphNode[];
    /** All edges in the graph */
    edges: GraphEdge[];
}

/**
 * Options for graph rendering
 */
export interface RenderOptions {
    /** Graph direction: top-down or left-right */
    direction?: 'TD' | 'LR';
    /** Show tools in node labels */
    showTools?: boolean;
}

/**
 * Default render options
 */
export const DEFAULT_RENDER_OPTIONS: Required<RenderOptions> = {
    direction: 'TD',
    showTools: true
};

// ============================================================================
// ELK (SVG) Renderer Payload
// ============================================================================

/**
 * Kind of node in the ELK payload. `start`/`end` are explicit synthesized
 * terminal nodes, so the webview never sniffs DOM geometry to find terminals.
 */
export type ElkNodeKind = 'llm' | 'tool' | 'confirmation' | 'start' | 'end';

/**
 * A node in the serialized graph payload sent to the ELK webview.
 *
 * IDs are kept RAW (no escaping) — the SVG renderer has no identifier syntax
 * constraints, so no id-mapping table is needed.
 */
export interface ElkPayloadNode {
    /** Raw node id (matches step id; or `__start__` / `__end__` for terminals) */
    id: string;
    /** Node kind — drives card styling and terminal rendering */
    kind: ElkNodeKind;
    /** Card header (step id) — omitted for terminals */
    header?: string;
    /** Card body (step description) — omitted for terminals */
    body?: string;
    /** Tool badges (deduplicated) */
    tools?: string[];
    /** Model badge id/alias */
    model?: string;
}

/**
 * An edge in the serialized graph payload sent to the ELK webview.
 */
export interface ElkPayloadEdge {
    /** Stable unique edge id */
    id: string;
    /** Source node id */
    from: string;
    /** Target node id (a real node, or `__end__` for terminal-bound edges) */
    to: string;
    /** Optional edge label (verbatim — HTML-escaped at render time) */
    label?: string;
    /** Original edge type, or 'terminal' for edges into the synthesized end node */
    kind: EdgeType | 'terminal';
}

/**
 * Serialized skill graph consumed by the ELK (SVG) webview renderer.
 *
 * Layout (ELK) and the two-pass card measurement happen client-side in the
 * webview, so the extension only ships this structural description.
 */
export interface ElkGraphPayload {
    /** Skill name */
    title: string;
    /** Layout direction */
    direction: 'TD' | 'LR';
    /** All nodes including synthesized start/end terminals */
    nodes: ElkPayloadNode[];
    /** All edges including start and terminal edges */
    edges: ElkPayloadEdge[];
}

/**
 * Messages sent from webview to extension
 */
export type WebviewMessage =
    | { type: 'navigate'; stepId: string }
    | { type: 'ready' };

/**
 * Messages sent from extension to webview
 */
export type ExtensionMessage =
    | { type: 'updateGraph'; payload: ElkGraphPayload }
    | { type: 'error'; title: string; message: string }
    | { type: 'warning'; title: string; message: string; count: number }
    | { type: 'clearError' }
    | { type: 'highlightStep'; stepId: string; status: StepStatus }
    | { type: 'highlightTerminal'; terminal: 'start' | 'end'; status: TerminalStatus }
    | { type: 'resetHighlights' }
    | { type: 'setModelOverride'; model: string | null }
    | { type: 'updateStepModel'; stepId: string; model: string; source: ModelSource };
