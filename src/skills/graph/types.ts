/**
 * Graph Types
 *
 * Interfaces for the skill graph visualization system.
 * Designed for extensibility - new renderers can be added without changing core.
 */

import type { StepStatus, TerminalStatus } from '../execution-state';
import type { ModelSource } from '../types';

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
 * Renders a SkillGraph to a specific format
 *
 * @template T - Output type (string for Mermaid/ASCII, SVGElement for SVG, etc.)
 */
export interface GraphRenderer<T> {
    /**
     * Render the graph to the target format
     */
    render(graph: SkillGraph): T;
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

/**
 * Messages sent from webview to extension
 */
export type WebviewMessage =
    | { type: 'navigate'; stepId: string }
    | { type: 'ready' };

/**
 * Metadata for a single node (for Card UI rendering in webview)
 */
export interface NodeMetadata {
    /** Node type for styling */
    type: 'llm' | 'tool' | 'confirmation' | 'terminal';
    /** Tools for this step (each gets a separate badge) */
    tools?: string[];
    /** Model ID or alias (for model badge) */
    model?: string;
    /** How the model was determined (from static YAML config) */
    modelSource?: ConfigModelSource;
    /** Step ID for card header */
    stepId?: string;
    /** Step description for card body */
    description?: string;
}

/**
 * Messages sent from extension to webview
 */
export type ExtensionMessage =
    | { type: 'update'; mermaidCode: string; idMapping?: Record<string, string>; nodeMetadata?: Record<string, NodeMetadata> }
    | { type: 'error'; title: string; message: string }
    | { type: 'warning'; title: string; message: string; count: number }
    | { type: 'clearError' }
    | { type: 'highlightStep'; stepId: string; status: StepStatus }
    | { type: 'highlightTerminal'; terminal: 'start' | 'end'; status: TerminalStatus }
    | { type: 'resetHighlights' }
    | { type: 'setModelOverride'; model: string | null }
    | { type: 'updateStepModel'; stepId: string; model: string; source: ModelSource };
