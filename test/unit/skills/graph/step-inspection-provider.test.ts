/**
 * Tests for the read-only step-inspection document provider: it renders the captured
 * prompt/response for a step as Markdown, shows a friendly message when nothing
 * was captured, and refreshes (onDidChange) when a step re-runs.
 */

import { describe, it, expect } from 'vitest';
import { StepInspectionDocumentProvider } from '../../../../src/skills/graph/step-inspection-provider';
import { buildStepInspectionUri } from '../../../../src/skills/step-inspection';
import { ExecutionStateEmitter } from '../../../../src/skills/execution-state';
import type { StepInspection } from '../../../../src/skills/execution-state';

const sample: StepInspection = {
    kind: 'llm',
    prompt: 'THE-PROMPT',
    response: 'THE-RESPONSE',
    modelUsed: 'gpt-4o',
    toolsUsed: [],
    durationMs: 7,
    status: 'completed'
};

describe('StepInspectionDocumentProvider', () => {
    it('renders captured step data as markdown', () => {
        const es = new ExecutionStateEmitter();
        es.startExecution('s', ['a']);
        es.recordStepInspection('s', 'a', sample);
        const provider = new StepInspectionDocumentProvider(es);

        const md = provider.provideTextDocumentContent(buildStepInspectionUri('s', 'a'));
        expect(md).toContain('# Step: a');
        expect(md).toContain('THE-PROMPT');
        expect(md).toContain('THE-RESPONSE');
        provider.dispose();
    });

    it('shows a no-data message when nothing was captured', () => {
        const es = new ExecutionStateEmitter();
        es.startExecution('s', ['a']);
        const provider = new StepInspectionDocumentProvider(es);

        const md = provider.provideTextDocumentContent(buildStepInspectionUri('s', 'a'));
        expect(md).toContain('No captured data');
        provider.dispose();
    });

    it('fires onDidChange when a step re-runs (capture refresh)', () => {
        const es = new ExecutionStateEmitter();
        es.startExecution('s', ['a']);
        const provider = new StepInspectionDocumentProvider(es);
        const fired: string[] = [];
        provider.onDidChange(uri => fired.push(uri.path));

        es.recordStepInspection('s', 'a', sample);
        expect(fired.length).toBe(1);
        provider.dispose();
    });

    it('stops firing after dispose', () => {
        const es = new ExecutionStateEmitter();
        es.startExecution('s', ['a']);
        const provider = new StepInspectionDocumentProvider(es);
        const fired: string[] = [];
        provider.onDidChange(uri => fired.push(uri.path));
        provider.dispose();

        es.recordStepInspection('s', 'a', sample);
        expect(fired.length).toBe(0);
    });
});
