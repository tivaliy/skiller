/**
 * Tests for the ELK graph payload serializer.
 *
 * The serializer turns the engine-agnostic SkillGraph into an ElkGraphPayload
 * with explicit synthesized start/end terminal nodes (no Mermaid `[*]` symbol)
 * and raw, un-escaped ids/labels.
 */

import { describe, it, expect } from 'vitest';
import { buildElkPayload, ELK_START_ID, ELK_END_ID } from '../../../../../src/skills/graph/elk/payload';
import type { SkillGraph } from '../../../../../src/skills/graph/types';

function graph(partial: Partial<SkillGraph>): SkillGraph {
    return { title: 'Test', nodes: [], edges: [], ...partial };
}

describe('buildElkPayload', () => {
    it('synthesizes a start node and an edge into the first node', () => {
        const payload = buildElkPayload(graph({
            nodes: [{ id: 'a', label: 'a: First', type: 'llm' }],
            edges: []
        }));

        const start = payload.nodes.find(n => n.kind === 'start');
        expect(start?.id).toBe(ELK_START_ID);
        expect(payload.edges.some(e => e.from === ELK_START_ID && e.to === 'a')).toBe(true);
    });

    it('splits the first-step guard into if/else start edges', () => {
        const payload = buildElkPayload(graph({
            nodes: [
                { id: 'a', label: 'a: First', type: 'llm', condition: 'x == 1' },
                { id: 'b', label: 'b: Second', type: 'llm' }
            ],
            edges: [{ from: 'a', to: 'b', type: 'sequential' }]
        }));

        const startEdges = payload.edges.filter(e => e.from === ELK_START_ID);
        expect(startEdges).toHaveLength(2);
        expect(startEdges.find(e => e.to === 'a')?.label).toContain('if');
        expect(startEdges.find(e => e.to === 'b')?.label).toBe('else');
    });

    it('routes abort edges to the synthesized end node, preserving the label', () => {
        const payload = buildElkPayload(graph({
            nodes: [{ id: 'a', label: 'a', type: 'confirmation' }],
            edges: [{ from: 'a', to: 'END_a', type: 'abort', label: 'Stop here' }]
        }));

        const end = payload.nodes.find(n => n.kind === 'end');
        expect(end?.id).toBe(ELK_END_ID);
        const abortEdge = payload.edges.find(e => e.from === 'a' && e.to === ELK_END_ID);
        expect(abortEdge?.label).toBe('Stop here');
        expect(abortEdge?.kind).toBe('terminal');
    });

    it('routes END_* targets to the end node', () => {
        const payload = buildElkPayload(graph({
            nodes: [{ id: 'a', label: 'a', type: 'llm' }],
            edges: [{ from: 'a', to: 'END_a', type: 'sequential' }]
        }));

        expect(payload.edges.some(e => e.from === 'a' && e.to === ELK_END_ID)).toBe(true);
    });

    it('adds an end edge for a node with no outgoing edges', () => {
        const payload = buildElkPayload(graph({
            nodes: [
                { id: 'a', label: 'a', type: 'llm' },
                { id: 'b', label: 'b', type: 'llm' }
            ],
            edges: [{ from: 'a', to: 'b', type: 'sequential' }]
        }));

        // b has no outgoing edge -> b --> end
        expect(payload.edges.some(e => e.from === 'b' && e.to === ELK_END_ID)).toBe(true);
    });

    it('keeps confirmation option labels verbatim (no colon mangling)', () => {
        const payload = buildElkPayload(graph({
            nodes: [
                { id: 'ask', label: 'ask', type: 'confirmation' },
                { id: 'answer', label: 'answer', type: 'llm' }
            ],
            edges: [{ from: 'ask', to: 'answer', type: 'sequential', label: 'Sometimes / Not sure' }]
        }));

        const e = payload.edges.find(x => x.from === 'ask' && x.to === 'answer');
        expect(e?.label).toBe('Sometimes / Not sure');
    });

    it('preserves backward goto (cyclic) edges between real nodes', () => {
        const payload = buildElkPayload(graph({
            nodes: [
                { id: 'ask', label: 'ask', type: 'confirmation' },
                { id: 'answer', label: 'answer', type: 'confirmation' }
            ],
            edges: [
                { from: 'ask', to: 'answer', type: 'sequential' },
                { from: 'answer', to: 'ask', type: 'goto', label: 'Nope — keep asking' }
            ]
        }));

        const back = payload.edges.find(e => e.from === 'answer' && e.to === 'ask');
        expect(back?.kind).toBe('goto');
        expect(back?.label).toBe('Nope — keep asking');
    });

    it('parses header (id) and body (description) and keeps raw ids', () => {
        const payload = buildElkPayload(graph({
            nodes: [{ id: 'fetch-data', label: 'fetch-data: Fetch the article', type: 'tool', tool: 'http_get' }],
            edges: []
        }));

        const node = payload.nodes.find(n => n.id === 'fetch-data');
        expect(node?.header).toBe('fetch-data');
        expect(node?.body).toBe('Fetch the article');
        expect(node?.kind).toBe('tool');
        expect(node?.tools).toEqual(['http_get']);
    });

    it('deduplicates tool against tools list', () => {
        const payload = buildElkPayload(graph({
            nodes: [{ id: 'a', label: 'a', type: 'tool', tool: 'http_get', tools: ['http_get', 'web_search'] }],
            edges: []
        }));

        expect(payload.nodes.find(n => n.id === 'a')?.tools).toEqual(['http_get', 'web_search']);
    });

    it('omits tools when showTools is false', () => {
        const payload = buildElkPayload(graph({
            nodes: [{ id: 'a', label: 'a', type: 'tool', tool: 'http_get' }],
            edges: []
        }), { showTools: false });

        expect(payload.nodes.find(n => n.id === 'a')?.tools).toBeUndefined();
    });

    it('groups parallel edges (same from/to) into one, joining labels with " / "', () => {
        const payload = buildElkPayload(graph({
            nodes: [
                { id: 'a', label: 'a', type: 'confirmation' },
                { id: 'b', label: 'b', type: 'llm' }
            ],
            edges: [
                { from: 'a', to: 'b', type: 'sequential', label: 'Yes' },
                { from: 'a', to: 'b', type: 'sequential', label: 'No' }
            ]
        }));

        const ab = payload.edges.filter(e => e.from === 'a' && e.to === 'b');
        expect(ab).toHaveLength(1);
        expect(ab[0].label).toBe('Yes / No');
    });

    it('does NOT group edges with different targets', () => {
        const payload = buildElkPayload(graph({
            nodes: [
                { id: 'a', label: 'a', type: 'confirmation' },
                { id: 'b', label: 'b', type: 'llm' },
                { id: 'c', label: 'c', type: 'llm' }
            ],
            edges: [
                { from: 'a', to: 'b', type: 'sequential', label: 'Yes' },
                { from: 'a', to: 'c', type: 'goto', label: 'No' }
            ]
        }));

        expect(payload.edges.find(e => e.from === 'a' && e.to === 'b')?.label).toBe('Yes');
        expect(payload.edges.find(e => e.from === 'a' && e.to === 'c')?.label).toBe('No');
    });

    it('assigns unique edge ids', () => {
        const payload = buildElkPayload(graph({
            nodes: [
                { id: 'ask', label: 'ask', type: 'confirmation' },
                { id: 'answer', label: 'answer', type: 'llm' },
                { id: 'guess', label: 'guess', type: 'llm' }
            ],
            edges: [
                { from: 'ask', to: 'answer', type: 'sequential' },
                { from: 'answer', to: 'guess', type: 'sequential' }
            ]
        }));

        const ids = payload.edges.map(e => e.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('carries direction through', () => {
        const payload = buildElkPayload(graph({ nodes: [{ id: 'a', label: 'a', type: 'llm' }] }), { direction: 'LR' });
        expect(payload.direction).toBe('LR');
    });
});
