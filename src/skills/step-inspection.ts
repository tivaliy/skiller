/**
 * Step Inspection Helpers
 *
 * Pure helpers for the "inspect an executed node" feature:
 * - build a StepInspection snapshot from a completed StepResult,
 * - render that snapshot as Markdown for the read-only inspector document,
 * - build/parse the inspector document URI.
 *
 * Kept free of execution/UI state so it is trivially unit-testable. Only the URI
 * helpers touch the vscode API (Uri construction).
 *
 * ## Extending
 * - New captured field (tokens, cost, …): add an optional field to StepInspection
 *   (execution-state.ts), map it in buildStepInspection, and render it in
 *   renderStepInspectionMarkdown + the webview popover. The host↔webview transport
 *   carries StepInspection opaquely, so no message-protocol change is needed.
 * - New inspectable step kind (e.g. tool I/O): extend StepInspectionKind, set
 *   `inspectionKind` on the relevant StepHandler, and add a mapping in
 *   buildStepInspection if the shape differs.
 * - New surface (a panel, an export, a tree view): read the data via
 *   panelManager.getStepInspection() or ExecutionState.stepInspections and reuse
 *   renderStepInspectionMarkdown. Do NOT import the graph/presentation layer from
 *   here or from execution-state.ts — that one-way dependency is what keeps the
 *   feature open for extension, and it is enforced by
 *   test/unit/skills/architecture.test.ts.
 */

import * as vscode from 'vscode';
import type { StepResult } from './types';
import type { StepInspection, StepInspectionKind } from './execution-state';
import { formatDuration, fence } from './utils';

/** URI scheme for the read-only step-inspection inspector document. */
export const STEP_INSPECTION_SCHEME = 'skiller-inspect';

/**
 * Build a StepInspection snapshot from a completed StepResult.
 *
 * The interpolated prompt is already on `stepResult.prompt`; the response is on
 * `stepResult.data` (a string, or a JSON-parsed object — stringified here).
 */
export function buildStepInspection(stepResult: StepResult, kind: StepInspectionKind): StepInspection {
    return {
        kind,
        prompt: stepResult.prompt ?? '',
        response: stringifyResponse(stepResult.data),
        modelUsed: stepResult.modelUsed,
        toolsUsed: stepResult.toolsUsed,
        durationMs: stepResult.duration,
        status: stepResult.success ? 'completed' : 'error',
        error: stepResult.error
    };
}

/**
 * Normalize a step's response payload to a display string.
 * Objects are pretty-printed; null/undefined become an empty string.
 */
function stringifyResponse(data: unknown): string {
    if (data == null) return '';
    if (typeof data === 'string') return data;
    try {
        return JSON.stringify(data, null, 2);
    } catch {
        return String(data);
    }
}

/**
 * Render a StepInspection snapshot as a Markdown document for the inspector tab.
 * Code fences inside content are neutralized so they can't break out of the block.
 */
export function renderStepInspectionMarkdown(stepId: string, data: StepInspection): string {
    const rows: (string | null)[] = [
        `| Kind | ${cell(data.kind)} |`,
        data.modelUsed ? `| Model | ${cell(data.modelUsed)} |` : null,
        `| Duration | ${cell(formatDuration(data.durationMs))} |`,
        data.toolsUsed?.length ? `| Tools | ${cell(data.toolsUsed.join(', '))} |` : null,
        `| Status | ${cell(data.status)} |`
    ];
    const table = ['| Field | Value |', '| --- | --- |', ...rows.filter(Boolean)].join('\n');

    const sections: (string | null)[] = [
        `# Step: ${stepId}`,
        table,
        // Always show Error for a failed step, even if the message is empty.
        data.status === 'error' ? `## Error\n\n${data.error ? fence(data.error) : '_(no error message)_'}` : null,
        `## Prompt\n\n${fence(data.prompt)}`,
        // LLM steps always show Response (placeholder if the model returned no text);
        // confirmation steps have no response concept, so omit it.
        data.kind === 'llm' ? `## Response\n\n${data.response ? fence(data.response) : '_(no response text)_'}` : null
    ];

    return sections.filter(Boolean).join('\n\n') + '\n';
}

/** Escape a Markdown table cell value (pipes/newlines would otherwise break the row). */
function cell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Build the read-only inspector URI for a step.
 *
 * Step ids are safe slugs (schema-constrained) and kept readable, so the editor
 * tab title reads `<step>.md`. Skill ids are NOT schema-constrained, so they are
 * base64url-encoded into the path: that alphabet has no '/', '.', '%' or padding,
 * so the URI survives any VS Code path normalization that would otherwise corrupt
 * percent-escapes for a skill id containing special characters.
 */
export function buildStepInspectionUri(skillId: string, stepId: string): vscode.Uri {
    const skillToken = Buffer.from(skillId, 'utf8').toString('base64url');
    const path = `/${skillToken}/${stepId}.md`;
    return vscode.Uri.from({ scheme: STEP_INSPECTION_SCHEME, path });
}

/**
 * Parse a step-inspection URI back to its skill/step ids.
 * Returns null for any URI that isn't a well-formed step-inspection URI.
 */
export function parseStepInspectionUri(uri: vscode.Uri): { skillId: string; stepId: string } | null {
    if (uri.scheme !== STEP_INSPECTION_SCHEME) {
        return null;
    }

    const segments = uri.path.replace(/^\//, '').split('/');
    if (segments.length !== 2) {
        return null;
    }

    const [skillToken, stepFile] = segments;
    if (!stepFile.endsWith('.md')) {
        return null;
    }

    try {
        return {
            skillId: Buffer.from(skillToken, 'base64url').toString('utf8'),
            stepId: stepFile.slice(0, -'.md'.length)
        };
    } catch {
        return null;
    }
}
