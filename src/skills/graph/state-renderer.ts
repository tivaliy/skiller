/**
 * State Diagram Renderer
 *
 * Converts a SkillGraph to Mermaid stateDiagram-v2 syntax.
 * State diagrams are semantically better for workflows (states + transitions).
 */

import type { SkillGraph, GraphNode, GraphEdge, GraphRenderer, RenderOptions, NodeMetadata } from './types';
import { DEFAULT_RENDER_OPTIONS } from './types';
import * as crypto from 'crypto';
import { formatCondition } from './formatting';

/**
 * Result of rendering a skill graph
 */
export interface RenderResult {
    /** Mermaid syntax */
    mermaidCode: string;
    /** Mapping of escaped IDs to original IDs (for click navigation) */
    idMapping: Record<string, string>;
    /** Metadata for each node (keyed by escaped ID) */
    nodeMetadata: Record<string, NodeMetadata>;
}

/**
 * Renders a SkillGraph to Mermaid stateDiagram-v2 syntax
 */
export class StateRenderer implements GraphRenderer<string> {
    private options: Required<RenderOptions>;
    private idMapping: Record<string, string> = {};
    private nodeMetadata: Record<string, NodeMetadata> = {};
    private escapedIdByOriginal: Record<string, string> = {};
    private usedEscapedIds = new Set<string>();
    private reservedEscapedIds = new Set<string>();

    constructor(options: RenderOptions = {}) {
        this.options = { ...DEFAULT_RENDER_OPTIONS, ...options };
    }

    /**
     * Render the graph to Mermaid state diagram syntax
     */
    render(graph: SkillGraph): string {
        return this.renderWithMapping(graph).mermaidCode;
    }

    /**
     * Render the graph to Mermaid syntax with ID mapping for click-to-navigate
     */
    renderWithMapping(graph: SkillGraph): RenderResult {
        this.idMapping = {};
        this.nodeMetadata = {};
        this.escapedIdByOriginal = {};
        this.usedEscapedIds = new Set<string>();
        this.reservedEscapedIds = this.computeReservedEscapedIds(graph);
        const mermaidCode = this.renderGraph(graph, graph.nodes);
        return {
            mermaidCode,
            idMapping: { ...this.idMapping },
            nodeMetadata: { ...this.nodeMetadata }
        };
    }

    /**
     * Reserve escaped IDs that exactly match a real step ID.
     *
     * This ensures that a step id that is already Mermaid-safe (e.g. "a_b")
     * keeps the readable identifier, while other ids that would normalize to the
     * same value (e.g. "a-b" -> "a_b") get disambiguated.
     */
    private computeReservedEscapedIds(graph: SkillGraph): Set<string> {
        const reserved = new Set<string>();

        const originalIds = new Set<string>();
        for (const node of graph.nodes) {
            originalIds.add(node.id);
        }
        for (const edge of graph.edges) {
            originalIds.add(edge.from);
            originalIds.add(edge.to);
        }

        for (const id of originalIds) {
            const base = this.computeBaseEscapedId(id);
            if (base === id) {
                reserved.add(base);
            }
        }

        return reserved;
    }

    /**
     * Compute the base Mermaid-safe ID (without collision disambiguation).
     */
    private computeBaseEscapedId(id: string): string {
        let base = id.replace(/[^a-zA-Z0-9_]/g, '_');
        if (!base) {
            base = 'state';
        }
        if (/^\d/.test(base)) {
            base = `s_${base}`;
        }
        return base;
    }

    /**
     * Internal render implementation
     */
    private renderGraph(graph: SkillGraph, nodes: GraphNode[]): string {
        const lines: string[] = [];

        // Build lookup map for node metadata
        const nodeById = new Map<string, GraphNode>();
        for (const node of nodes) {
            nodeById.set(node.id, node);
        }

        // State diagram header
        lines.push('stateDiagram-v2');

        // Add direction if not default (TD)
        if (this.options.direction === 'LR') {
            lines.push('    direction LR');
        }

        // Start state transition(s) to first node
        // If the first step is guarded (`when`), runtime may skip it and proceed to the next step.
        if (graph.nodes.length > 0) {
            const firstNode = graph.nodes[0];
            if (firstNode.condition) {
                const condition = formatCondition(firstNode.condition);
                lines.push(`    [*] --> ${this.escapeId(firstNode.id)} : ${this.escapeTransitionLabel(`if ${condition}`)}`);
                if (graph.nodes.length > 1) {
                    lines.push(`    [*] --> ${this.escapeId(graph.nodes[1].id)} : else`);
                }
            } else {
                lines.push(`    [*] --> ${this.escapeId(firstNode.id)}`);
            }
        }

        // Add state definitions with descriptions
        for (const node of graph.nodes) {
            const stateDef = this.renderState(node);
            if (stateDef) {
                lines.push(`    ${stateDef}`);
            }
        }

        // Apply styles to nodes by type
        lines.push('');
        lines.push('    %% Apply styles');
        for (const node of graph.nodes) {
            if (node.type === 'terminal') continue;
            const styleClass = this.getStyleClass(node.type);
            if (styleClass) {
                lines.push(`    class ${this.escapeId(node.id)} ${styleClass}`);
            }
        }

        // Add blank line before transitions
        lines.push('');

        // Add transitions
        for (const edge of graph.edges) {
            lines.push(`    ${this.renderTransition(edge)}`);
        }

        // Add terminal transitions to [*] for nodes with no outgoing edges
        const nodesWithOutgoing = new Set(graph.edges.map(e => e.from));
        const terminalNodes = graph.nodes.filter(n =>
            !nodesWithOutgoing.has(n.id) && n.type !== 'terminal'
        );

        for (const node of terminalNodes) {
            lines.push(`    ${this.escapeId(node.id)} --> [*]`);
        }

        return lines.join('\n');
    }

    /**
     * Render a state definition
     * Format: state "Line1<br/>Line2" as stateId
     *
     * Uses multi-line labels so Mermaid creates taller nodes.
     * Badges (tool/model) are rendered by webview from nodeMetadata.
     */
    private renderState(node: GraphNode): string | null {
        const escapedId = this.escapeId(node.id);

        // Skip terminal nodes - we use [*] for end
        if (node.type === 'terminal') {
            return null;
        }

        const tools = this.getToolsList(node);

        // Extract description from label (format: "id: description")
        let description = node.label;
        const colonIdx = description.indexOf(':');
        if (colonIdx > 0) {
            description = description.substring(colonIdx + 1).trim();
        }

        // Store metadata for webview (badges rendered there)
        this.nodeMetadata[escapedId] = {
            type: node.type,
            tools: this.options.showTools && tools.length > 0 ? tools : undefined,
            model: node.model,
            modelSource: node.modelSource
        };

        // Build multi-line label: Step ID + Description + Badge placeholders
        // Badges come from metadata, rendered by webview
        const lines: string[] = [node.id];

        if (description && description !== node.id) {
            lines.push(this.escapeLabel(description));
        } else {
            // Generate width placeholder if step ID is short
            // Uses middle dots (·) which Mermaid respects for sizing
            const minWidth = 16;
            if (node.id.length < minWidth) {
                const dotsNeeded = Math.ceil((minWidth - node.id.length) / 2);
                lines.push('· '.repeat(dotsNeeded).trim());
            }
        }

        // Add placeholder lines for badge rows to reserve height
        // This ensures Mermaid calculates node bounds including badge space
        const badgeCount = tools.length + (node.model ? 1 : 0);
        if (badgeCount > 0) {
            // Estimate ~2 badges per row (conservative for narrow nodes)
            const badgeRows = Math.ceil(badgeCount / 2);
            for (let i = 0; i < badgeRows; i++) {
                // Use invisible placeholder that takes up height but minimal width
                lines.push('·');
            }
        }

        return `state "${lines.join('<br/>')}" as ${escapedId}`;
    }

    /**
     * Escape label text for Mermaid state diagrams
     */
    private escapeLabel(label: string): string {
        return label
            .replace(/[<>]/g, '')         // Strip angle brackets (Mermaid stereotypes / HTML injection)
            .replace(/"/g, "'")           // Replace double quotes
            .replace(/\n/g, ' ')          // Replace newlines
            .replace(/\s+/g, ' ')         // Collapse whitespace
            .trim();
    }

    /**
     * Get tools list for a node
     * Returns array of tool names (deduplicated)
     */
    private getToolsList(node: GraphNode): string[] {
        const tools: string[] = [];

        if (node.tool) {
            tools.push(node.tool);
        }
        if (node.tools && node.tools.length > 0) {
            tools.push(...node.tools.filter(t => t !== node.tool));
        }

        return tools;
    }

    /**
     * Render a transition between states
     * Format: StateA --> StateB : label
     */
    private renderTransition(edge: GraphEdge): string {
        const from = this.escapeId(edge.from);

        // Convert terminal nodes (END_*) and abort edges to [*]
        const isTerminal = edge.type === 'abort' || edge.to.startsWith('END_');
        const to = isTerminal ? '[*]' : this.escapeId(edge.to);

        // Add transition label based on type
        const label = this.getTransitionLabel(edge);

        if (label) {
            return `${from} --> ${to} : ${label}`;
        }

        return `${from} --> ${to}`;
    }

    /**
     * Get transition label based on edge type and original label
     */
    private getTransitionLabel(edge: GraphEdge): string | null {
        // Use the edge label if present (from confirmation options or conditional guards)
        if (edge.label) {
            return this.escapeTransitionLabel(edge.label);
        }

        return null;
    }

    /**
     * Escape label text for transition labels (more restrictive than state labels)
     */
    private escapeTransitionLabel(label: string): string {
        return label
            .replace(/[<>]/g, '')         // Strip angle brackets (Mermaid stereotypes / HTML injection)
            .replace(/"/g, "'")
            .replace(/:/g, '-')           // Colons are delimiters in transitions
            .replace(/\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Escape state ID for Mermaid and track mapping
     */
    private escapeId(id: string): string {
        // Ensure stable mapping within this render
        const cached = this.escapedIdByOriginal[id];
        if (cached) {
            return cached;
        }

        const base = this.computeBaseEscapedId(id);

        let escaped = base;

        // If this would collide with a reserved (already-safe) ID, disambiguate.
        // This preserves readability for IDs that don't need escaping.
        const collidesWithReservedSafeId = this.reservedEscapedIds.has(base) && base !== id;

        // If this escaped ID is already used by a different original ID, disambiguate.
        if (collidesWithReservedSafeId || this.usedEscapedIds.has(escaped)) {
            const suffix = crypto
                .createHash('sha1')
                .update(id)
                .digest('hex')
                .slice(0, 10);
            escaped = `${base}__${suffix}`;
        }

        this.usedEscapedIds.add(escaped);
        this.escapedIdByOriginal[id] = escaped;

        // Track mapping for navigation when Mermaid ID differs from original
        if (escaped !== id) {
            this.idMapping[escaped] = id;
        }

        return escaped;
    }

    /**
     * Get the style class name for a node type
     */
    private getStyleClass(type: GraphNode['type']): string | null {
        switch (type) {
            case 'tool':
                return 'toolStep';
            case 'llm':
                return 'llmStep';
            case 'confirmation':
                return 'confirmStep';
            default:
                return null;
        }
    }
}
