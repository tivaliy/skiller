/**
 * Tests for the pure step-inspection helpers: building a StepInspection snapshot from
 * a StepResult, rendering it to Markdown for the read-only inspector document,
 * and the inspector URI round-trip.
 */

import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import {
    buildStepInspection,
    renderStepInspectionMarkdown,
    buildStepInspectionUri,
    parseStepInspectionUri,
    STEP_INSPECTION_SCHEME
} from '../../../src/skills/step-inspection';
import type { StepResult } from '../../../src/skills/types';
import type { StepInspection } from '../../../src/skills/execution-state';

describe('buildStepInspection', () => {
    const base: StepResult = { stepId: 'a', success: true, duration: 12 };

    it('captures the interpolated prompt and string response for an llm step', () => {
        const data = buildStepInspection(
            { ...base, prompt: 'Hello Sam', data: 'the answer', modelUsed: 'gpt-4o', toolsUsed: ['readFile'] },
            'llm'
        );
        expect(data).toEqual({
            kind: 'llm',
            prompt: 'Hello Sam',
            response: 'the answer',
            modelUsed: 'gpt-4o',
            toolsUsed: ['readFile'],
            durationMs: 12,
            status: 'completed'
        });
    });

    it('stringifies an object response as pretty JSON', () => {
        const data = buildStepInspection({ ...base, prompt: 'p', data: { ok: true, n: 1 } }, 'llm');
        expect(data.response).toBe(JSON.stringify({ ok: true, n: 1 }, null, 2));
    });

    it('uses an empty response when data is absent (e.g. confirmation)', () => {
        const data = buildStepInspection({ ...base, prompt: 'Proceed?' }, 'confirmation');
        expect(data.kind).toBe('confirmation');
        expect(data.response).toBe('');
    });

    it('marks status error when the step failed', () => {
        const data = buildStepInspection({ ...base, success: false, prompt: 'p', error: 'boom' }, 'llm');
        expect(data.status).toBe('error');
    });

    it('captures the error message for a failed step', () => {
        const data = buildStepInspection({ ...base, success: false, prompt: 'p', error: 'model exploded' }, 'llm');
        expect(data.status).toBe('error');
        expect(data.error).toBe('model exploded');
    });

    it('leaves error undefined for a successful step', () => {
        const data = buildStepInspection({ ...base, prompt: 'p', data: 'ok' }, 'llm');
        expect(data.error).toBeUndefined();
    });

    it('defaults prompt to an empty string when missing', () => {
        const data = buildStepInspection({ ...base, prompt: undefined }, 'llm');
        expect(data.prompt).toBe('');
    });
});

describe('renderStepInspectionMarkdown', () => {
    const data: StepInspection = {
        kind: 'llm',
        prompt: 'PROMPT-TEXT',
        response: 'RESPONSE-TEXT',
        modelUsed: 'gpt-4o',
        toolsUsed: ['readFile'],
        durationMs: 1500,
        status: 'completed'
    };

    it('renders a heading, metadata and prompt/response sections', () => {
        const md = renderStepInspectionMarkdown('analyze', data);
        expect(md).toContain('# Step: analyze');
        expect(md).toContain('## Prompt');
        expect(md).toContain('PROMPT-TEXT');
        expect(md).toContain('## Response');
        expect(md).toContain('RESPONSE-TEXT');
        expect(md).toContain('gpt-4o');
    });

    it('omits the Response section when there is no response', () => {
        const md = renderStepInspectionMarkdown('confirm', { ...data, kind: 'confirmation', response: '' });
        expect(md).not.toContain('## Response');
    });

    it('escapes code fences in content so they cannot break out of the block', () => {
        const md = renderStepInspectionMarkdown('x', { ...data, prompt: 'before ``` after' });
        expect(md).not.toContain('before ``` after');
        expect(md).toContain('before ` ` ` after');
    });

    it('keeps metadata table rows intact when a value contains a newline', () => {
        const md = renderStepInspectionMarkdown('x', { ...data, modelUsed: 'line1\nline2' });
        expect(md).not.toContain('line1\nline2');
        expect(md).toContain('line1 line2');
    });

    it('includes an Error section when the inspection has an error', () => {
        const md = renderStepInspectionMarkdown('x', { ...data, status: 'error', error: 'boom happened' });
        expect(md).toContain('## Error');
        expect(md).toContain('boom happened');
    });

    it('omits the Error section when there is no error', () => {
        expect(renderStepInspectionMarkdown('x', data)).not.toContain('## Error');
    });

    it('shows the Error section with a placeholder when a failed step has no message', () => {
        const md = renderStepInspectionMarkdown('x', { ...data, status: 'error', error: '' });
        expect(md).toContain('## Error');
        expect(md).toContain('(no error message)');
    });

    it('shows the Response section with a placeholder for an llm step with an empty response', () => {
        const md = renderStepInspectionMarkdown('x', { ...data, kind: 'llm', response: '' });
        expect(md).toContain('## Response');
        expect(md).toContain('(no response text)');
    });
});

describe('step-inspection URI round-trip', () => {
    it('builds a URI with the step-inspection scheme and a .md path', () => {
        const uri = buildStepInspectionUri('my-skill', 'my-step');
        expect(uri.scheme).toBe(STEP_INSPECTION_SCHEME);
        expect(uri.path.endsWith('.md')).toBe(true);
    });

    it('round-trips a normal skill/step id', () => {
        const uri = buildStepInspectionUri('greeter', 'ask');
        expect(parseStepInspectionUri(uri)).toEqual({ skillId: 'greeter', stepId: 'ask' });
    });

    it('round-trips a skill id with special characters (skill ids are not slug-constrained)', () => {
        const uri = buildStepInspectionUri('group/skill x%', 'analyze-step');
        expect(parseStepInspectionUri(uri)).toEqual({ skillId: 'group/skill x%', stepId: 'analyze-step' });
    });

    it('returns null for a foreign scheme', () => {
        expect(parseStepInspectionUri(vscode.Uri.file('/tmp/x.md'))).toBeNull();
    });
});
