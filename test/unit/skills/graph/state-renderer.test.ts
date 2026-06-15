/**
 * Tests for StateRenderer
 */

import { describe, it, expect } from 'vitest';
import { StateRenderer } from '../../../../src/skills/graph/state-renderer';
import type { SkillGraph, GraphNode, GraphEdge } from '../../../../src/skills/graph/types';

// ============================================================================
// Helpers
// ============================================================================

function makeGraph(overrides: Partial<SkillGraph> = {}): SkillGraph {
    return {
        title: 'test',
        nodes: [],
        edges: [],
        ...overrides
    };
}

function makeNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
    return {
        id,
        label: id,
        type: 'llm',
        ...overrides
    };
}

function makeEdge(from: string, to: string, overrides: Partial<GraphEdge> = {}): GraphEdge {
    return {
        from,
        to,
        type: 'sequential',
        ...overrides
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('StateRenderer', () => {
    describe('render basics', () => {
        it('renders empty graph with header only', () => {
            const graph = makeGraph();
            const renderer = new StateRenderer();
            const result = renderer.render(graph);

            expect(result).toContain('stateDiagram-v2');
            expect(result).not.toContain('[*] -->');
        });

        it('renders single node with start transition', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1')],
                edges: []
            });
            const renderer = new StateRenderer();
            const result = renderer.render(graph);

            expect(result).toContain('[*] --> step1');
            expect(result).toContain('step1 --> [*]'); // Terminal transition for node with no outgoing edges
        });

        it('renders guarded first node with conditional start transition and skip branch', () => {
            const graph = makeGraph({
                nodes: [
                    makeNode('step1', { condition: 'inputs.enabled' }),
                    makeNode('step2')
                ],
                edges: [makeEdge('step1', 'step2')]
            });
            const renderer = new StateRenderer();
            const result = renderer.render(graph);

            expect(result).toContain('[*] --> step1 : if inputs.enabled');
            expect(result).toContain('[*] --> step2 : else');
        });

        it('renders sequential edges between nodes', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1'), makeNode('step2')],
                edges: [makeEdge('step1', 'step2')]
            });
            const renderer = new StateRenderer();
            const result = renderer.render(graph);

            expect(result).toContain('[*] --> step1');
            expect(result).toContain('step1 --> step2');
            expect(result).toContain('step2 --> [*]');
        });

        it('renders node labels with descriptions', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1', { label: 'step1: Fetch data from API' })],
                edges: []
            });
            const renderer = new StateRenderer();
            const result = renderer.render(graph);

            // Renderer splits into multiline label: StepId + Description
            expect(result).toContain('state "step1<br/>Fetch data from API" as step1');
        });
    });

    describe('ID escaping', () => {
        it('escapes special characters in IDs', () => {
            const graph = makeGraph({
                nodes: [makeNode('step-with-dashes')],
                edges: []
            });
            const renderer = new StateRenderer();
            const { mermaidCode, idMapping } = renderer.renderWithMapping(graph);

            // ID should be escaped (dashes replaced with underscores)
            expect(mermaidCode).toContain('step_with_dashes');
            // Mapping should exist for navigation
            expect(idMapping['step_with_dashes']).toBe('step-with-dashes');
        });

        it('disambiguates escaped id collisions', () => {
            // "a-b" and "a_b" both escape to "a_b"
            const graph = makeGraph({
                nodes: [makeNode('a-b'), makeNode('a_b')],
                edges: [makeEdge('a-b', 'a_b')]
            });

            const renderer = new StateRenderer();
            const { mermaidCode, idMapping } = renderer.renderWithMapping(graph);

            // The already-safe "a_b" should keep its ID
            expect(mermaidCode).toContain('a_b');
            // The unsafe "a-b" should get a disambiguated ID
            const disambiguated = Object.keys(idMapping).find(k => k.startsWith('a_b__'));
            expect(disambiguated).toBeDefined();
            expect(idMapping[disambiguated!]).toBe('a-b');
        });

        it('handles IDs starting with numbers', () => {
            const graph = makeGraph({
                nodes: [makeNode('123step')],
                edges: []
            });
            const renderer = new StateRenderer();
            const { mermaidCode, idMapping } = renderer.renderWithMapping(graph);

            // Should prefix with s_ to make valid Mermaid ID
            expect(mermaidCode).toContain('s_123step');
            expect(idMapping['s_123step']).toBe('123step');
        });

        it('handles empty ID gracefully', () => {
            const graph = makeGraph({
                nodes: [makeNode('')],
                edges: []
            });
            const renderer = new StateRenderer();
            const { mermaidCode, idMapping } = renderer.renderWithMapping(graph);

            // Should use fallback 'state'
            expect(mermaidCode).toContain('state');
            expect(idMapping['state']).toBe('');
        });

        it('maintains stable ID mapping across multiple escapeId calls', () => {
            const graph = makeGraph({
                nodes: [makeNode('step-1'), makeNode('step-2')],
                edges: [makeEdge('step-1', 'step-2'), makeEdge('step-1', 'step-2')]
            });
            const renderer = new StateRenderer();
            const { mermaidCode } = renderer.renderWithMapping(graph);

            // Same ID should be escaped the same way each time
            const matches = mermaidCode.match(/step_1/g);
            expect(matches?.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('node types and styling', () => {
        it('applies toolStep class for tool nodes', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1', { type: 'tool' })],
                edges: []
            });
            const renderer = new StateRenderer();
            const result = renderer.render(graph);

            expect(result).toContain('class step1 toolStep');
        });

        it('applies llmStep class for llm nodes', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1', { type: 'llm' })],
                edges: []
            });
            const renderer = new StateRenderer();
            const result = renderer.render(graph);

            expect(result).toContain('class step1 llmStep');
        });

        it('applies confirmStep class for confirmation nodes', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1', { type: 'confirmation' })],
                edges: []
            });
            const renderer = new StateRenderer();
            const result = renderer.render(graph);

            expect(result).toContain('class step1 confirmStep');
        });

        it('skips terminal nodes in rendering', () => {
            const graph = makeGraph({
                nodes: [makeNode('END_step1', { type: 'terminal' })],
                edges: []
            });
            const renderer = new StateRenderer();
            const result = renderer.render(graph);

            // Terminal nodes shouldn't have state definitions
            expect(result).not.toContain('state "END_step1"');
        });
    });

    describe('edge types', () => {
        it('renders edge labels', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1'), makeNode('step2')],
                edges: [makeEdge('step1', 'step2', { label: 'Continue' })]
            });
            const renderer = new StateRenderer();
            const result = renderer.render(graph);

            expect(result).toContain('step1 --> step2 : Continue');
        });

        it('renders abort edges to terminal [*]', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1')],
                edges: [makeEdge('step1', 'END_step1', { type: 'abort', label: 'Cancel' })]
            });
            const renderer = new StateRenderer();
            const result = renderer.render(graph);

            expect(result).toContain('step1 --> [*] : Cancel');
        });

        it('escapes colons in edge labels', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1'), makeNode('step2')],
                edges: [makeEdge('step1', 'step2', { label: 'key: value' })]
            });
            const renderer = new StateRenderer();
            const result = renderer.render(graph);

            // Colons should be replaced with dashes
            expect(result).toContain('key- value');
            expect(result).not.toContain('key: value');
        });
    });

    describe('render options', () => {
        it('renders LR direction when specified', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1')],
                edges: []
            });
            const renderer = new StateRenderer({ direction: 'LR' });
            const result = renderer.render(graph);

            expect(result).toContain('direction LR');
        });

        it('does not render direction for default TD', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1')],
                edges: []
            });
            const renderer = new StateRenderer({ direction: 'TD' });
            const result = renderer.render(graph);

            expect(result).not.toContain('direction');
        });

        it('shows tools in labels when showTools is true', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1', { label: 'Fetch data', tool: 'api_fetch', tools: ['api_fetch', 'cache_read'] })],
                edges: []
            });
            const renderer = new StateRenderer({ showTools: true });
            const { nodeMetadata } = renderer.renderWithMapping(graph);

            // All tools passed as array for separate badges
            expect(nodeMetadata.step1.tools).toEqual(['api_fetch', 'cache_read']);
        });

        it('hides tools in labels when showTools is false', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1', { label: 'Fetch data', tool: 'api_fetch' })],
                edges: []
            });
            const renderer = new StateRenderer({ showTools: false });
            const { nodeMetadata } = renderer.renderWithMapping(graph);

            expect(nodeMetadata.step1.tools).toBeUndefined();
        });

        it('passes model and modelSource to nodeMetadata', () => {
            const graph = makeGraph({
                nodes: [
                    makeNode('step1', { model: 'fast', modelSource: 'explicit' }),
                    makeNode('step2', { model: 'gpt-4o', modelSource: 'inherited' })
                ],
                edges: []
            });
            const renderer = new StateRenderer();
            const { nodeMetadata } = renderer.renderWithMapping(graph);

            expect(nodeMetadata.step1.model).toBe('fast');
            expect(nodeMetadata.step1.modelSource).toBe('explicit');
            expect(nodeMetadata.step2.model).toBe('gpt-4o');
            expect(nodeMetadata.step2.modelSource).toBe('inherited');
        });

        it('omits modelSource when model is undefined', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1', { model: undefined, modelSource: undefined })],
                edges: []
            });
            const renderer = new StateRenderer();
            const { nodeMetadata } = renderer.renderWithMapping(graph);

            expect(nodeMetadata.step1.model).toBeUndefined();
            expect(nodeMetadata.step1.modelSource).toBeUndefined();
        });
    });

    describe('label escaping', () => {
        it('escapes double quotes in labels', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1', { label: 'Say "hello"' })],
                edges: []
            });
            const renderer = new StateRenderer();
            const result = renderer.render(graph);

            expect(result).toContain("Say 'hello'");
            expect(result).not.toContain('"hello"');
        });

        it('collapses whitespace in labels', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1', { label: 'Multiple   spaces\nand\nnewlines' })],
                edges: []
            });
            const renderer = new StateRenderer();
            const result = renderer.render(graph);

            expect(result).toContain('Multiple spaces and newlines');
        });
    });

    describe('renderWithMapping', () => {
        it('returns both mermaidCode and idMapping', () => {
            const graph = makeGraph({
                nodes: [makeNode('step-1')],
                edges: []
            });
            const renderer = new StateRenderer();
            const result = renderer.renderWithMapping(graph);

            expect(result).toHaveProperty('mermaidCode');
            expect(result).toHaveProperty('idMapping');
            expect(typeof result.mermaidCode).toBe('string');
            expect(typeof result.idMapping).toBe('object');
        });

        it('only includes mappings for escaped IDs', () => {
            const graph = makeGraph({
                nodes: [makeNode('safe_id'), makeNode('unsafe-id')],
                edges: []
            });
            const renderer = new StateRenderer();
            const { idMapping } = renderer.renderWithMapping(graph);

            // safe_id doesn't need mapping (already valid)
            expect(idMapping).not.toHaveProperty('safe_id');
            // unsafe-id needs mapping
            expect(idMapping['unsafe_id']).toBe('unsafe-id');
        });
    });

    describe('label escaping (S-20)', () => {
        it('strips angle brackets from node labels', () => {
            const graph = makeGraph({
                nodes: [makeNode('step1', { label: 'do <script>alert(1)</script> thing' })]
            });
            const result = new StateRenderer().render(graph);

            expect(result).not.toContain('<script>');
            expect(result).not.toContain('</script>');
            expect(result).toContain('scriptalert(1)'); // stripped form remains
        });

        it('strips angle brackets from transition labels', () => {
            const graph = makeGraph({
                nodes: [makeNode('a'), makeNode('b')],
                edges: [makeEdge('a', 'b', { label: 'when x <b> 0', type: 'conditional' })]
            });
            const result = new StateRenderer().render(graph);

            expect(result).not.toContain('<b>');
        });
    });
});
