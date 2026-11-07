/**
 * End-to-end workflow test for the built-in `skill-creator` skill.
 *
 * Drives the REAL skill (skills/skill-creator/*) through
 * plan → review(goto plan) → plan → review(continue) → build
 * with a fake language model, asserting that:
 * - a plain-prose (non-JSON) plan renders in the review message without throwing;
 * - the revision pass sees the previous plan and the chosen revision;
 * - the build step is offered `skiller_writeSkill` (required on the first turn);
 * - literal Liquid examples in the authoring reference survive interpolation;
 * - installed tools from `available_tools` reach the plan prompt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SkillExecutor } from '../../../src/skills/SkillExecutor';
import { createDefaultRegistry } from '../../../src/skills/handlers';
import { ExecutionStateEmitter } from '../../../src/skills/execution-state';
import { parseSkillFromContent } from '../../../src/skills/parser';
import { validateSkill } from '../../../src/skills/validators/factory';
import { checkReadiness } from '../../../src/skills/readiness/factory';
import type { ModelResolver } from '../../../src/skills/model-resolver';
import type { ExecutionOptions, Skill, ResolvedModel } from '../../../src/skills/types';
import { useDiskBackedVscodeFs } from '../../helpers/disk-vscode-fs';

const SKILL_DIR = path.join(__dirname, '../../../skills/skill-creator');

const PLAN_1 = `## Plan: changelog-writer

Inputs: diff, taken from the staged changes.

1. draft (llm): write a CHANGELOG entry from the diff.
2. approve (confirmation): show the entry; Write it continues, Cancel stops.
3. save (llm with a file tool): append the entry to CHANGELOG.md.`;

const PLAN_2 = `## Plan: changelog-writer

1. draft (llm): write a CHANGELOG entry from the staged diff.`;

interface Captured {
    prompts: string[];
    options: vscode.LanguageModelChatRequestOptions[];
}

/** A scripted model turn: plain text, or a tool call. */
type Turn = string | { toolCall: { name: string; input: object } };

/** Fake model: plays the scripted turns in order, recording each prompt and request options. */
function makeFakeModel(turns: Turn[], captured: Captured): vscode.LanguageModelChat {
    let call = 0;
    return {
        id: 'fake-model',
        sendRequest: vi.fn(async (
            messages: vscode.LanguageModelChatMessage[],
            options: vscode.LanguageModelChatRequestOptions,
        ) => {
            // The first message is always the rendered step prompt.
            captured.prompts.push(String(messages[0].content));
            captured.options.push(options);
            const turn = turns[Math.min(call, turns.length - 1)];
            call++;
            const part = typeof turn === 'string'
                ? new vscode.LanguageModelTextPart(turn)
                : new vscode.LanguageModelToolCallPart(`call-${call}`, turn.toolCall.name, turn.toolCall.input);
            return {
                stream: (async function* () { yield part; })(),
                text: (async function* () { /* unused */ })(),
            };
        }),
    } as unknown as vscode.LanguageModelChat;
}

function fakeResolver(model: vscode.LanguageModelChat): ModelResolver {
    const resolved: ResolvedModel = { model, displayName: 'fake-model', source: 'auto', usedFallback: false };
    return {
        resolve: async () => resolved,
        listModels: async () => [],
        extractDisplayName: () => 'fake-model',
    } as unknown as ModelResolver;
}

function makeOptions(executionState: ExecutionStateEmitter, inputs: Record<string, unknown>): ExecutionOptions {
    return {
        inputs,
        model: { id: 'fake-model' } as unknown as ExecutionOptions['model'],
        isAutoMode: true,
        // withTimeout links the tool invocation to this token, so it must be subscribable.
        token: {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose: () => undefined }),
        } as unknown as ExecutionOptions['token'],
        hooks: {},
        availableMcps: [],
        executionState,
    };
}

function loadSkill(): Skill {
    const yaml = fs.readFileSync(path.join(SKILL_DIR, 'skill.yaml'), 'utf8');
    const parsed = parseSkillFromContent(yaml, SKILL_DIR, { type: 'builtin', path: SKILL_DIR });
    if (!parsed.success) {
        throw new Error(`skill-creator failed to parse: ${parsed.error.error}`);
    }
    return parsed.skill;
}

const IDEA = 'summarize my staged diff and let me approve before writing a CHANGELOG entry';

describe('skill-creator workflow (end-to-end with fake LLM)', () => {
    beforeEach(() => {
        useDiskBackedVscodeFs();
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: (_key: string, def?: unknown) => def,
            update: vi.fn(),
            has: vi.fn(),
            inspect: vi.fn(),
        } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>);
        // The real API normalizes Assistant(content) to a parts array (the runner
        // pushes tool-call parts onto it); make the mock faithful to that.
        vi.mocked(vscode.LanguageModelChatMessage.Assistant).mockImplementation(
            (content) => ({
                role: 'assistant',
                content: Array.isArray(content) ? content : [],
            }) as unknown as vscode.LanguageModelChatMessage,
        );
        (vscode.lm as unknown as { tools: unknown[] }).tools = [
            { name: 'skiller_writeSkill', description: 'Writes a complete new Skiller skill folder', inputSchema: {} },
        ];
    });
    afterEach(() => {
        (vscode.lm as unknown as { tools: unknown[] }).tools = [];
    });

    it('parses, validates with step files, and is ready to run', async () => {
        const skill = loadSkill();
        expect(skill.id).toBe('skill-creator');

        const result = await validateSkill(skill, { validateStepFiles: true });
        expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
        expect(result.valid).toBe(true);

        expect(checkReadiness(skill, {}).errors).toEqual([]);
    });

    it('plans in prose, revises with the previous plan, then builds with skiller_writeSkill', async () => {
        const skill = loadSkill();
        const captured: Captured = { prompts: [], options: [] };
        vi.mocked(vscode.lm.invokeTool).mockResolvedValue(
            new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('Skill written: "changelog-writer" at /ws/.skiller/skills/changelog-writer.'),
            ]),
        );
        const model = makeFakeModel(
            [
                PLAN_1,                                                     // plan (pass 1) — prose, not JSON
                PLAN_2,                                                     // plan (pass 2)
                { toolCall: { name: 'skiller_writeSkill', input: { id: 'changelog-writer', files: [] } } },
                'Created changelog-writer.',                                // build: after the tool result
            ],
            captured,
        );

        const executionState = new ExecutionStateEmitter();
        const executor = new SkillExecutor(createDefaultRegistry(), fakeResolver(model));
        const opts = () => makeOptions(executionState, { idea: IDEA });

        // 1. plan → pauses at review, whose message renders the prose plan.
        let result = await executor.execute(skill, opts());
        expect(result.pendingConfirmation?.stepId).toBe('review');
        expect(result.context.outputs.plan).toBe(PLAN_1);
        expect(result.pendingConfirmation?.message).toContain('## Plan: changelog-writer');
        const reviewLines = (result.pendingConfirmation?.message ?? '').trim().split('\n');
        expect(reviewLines[reviewLines.length - 1]).toBe(
            'Not what you meant? Cancel and run `/new` again with a sharper description.',
        );

        // 2. "Make it simpler" → goto plan → pauses at review again.
        result = await executor.execute(skill, opts(), {
            startFromStep: skill.steps.findIndex(s => s.id === 'plan'),
            existingContext: result.context,
            existingStepResults: result.steps,
            completedStepId: 'review',
            recordOutput: {
                key: 'review',
                value: { selectedOption: 'Make it simpler', selectedIndex: 2, action: 'goto', timestamp: 0 },
            },
        });
        expect(result.pendingConfirmation?.stepId).toBe('review');
        expect(result.context.outputs.plan).toBe(PLAN_2);

        // 3. "Build it" → continue → build runs and the skill finishes.
        result = await executor.execute(skill, opts(), {
            startFromStep: skill.steps.findIndex(s => s.id === 'review') + 1,
            existingContext: result.context,
            existingStepResults: result.steps,
            completedStepId: 'review',
            recordOutput: {
                key: 'review',
                value: { selectedOption: 'Build it', selectedIndex: 1, action: 'continue', timestamp: 0 },
            },
        });
        expect(result.success, JSON.stringify(result.steps.map(s => s.error).filter(Boolean))).toBe(true);
        expect(result.pendingConfirmation).toBeUndefined();

        const [plan1Prompt, plan2Prompt, buildPrompt] = captured.prompts;

        // The idea reaches the plan; the first pass is not a revision.
        expect(plan1Prompt).toContain(IDEA);
        expect(plan1Prompt).not.toContain('Make it simpler');
        // Any [...] or {...} span in the reply is parsed as JSON, so the format rule forbids them.
        expect(plan1Prompt).toContain('square brackets');
        expect(plan1Prompt).toContain('checkboxes (`- [ ]`)');
        expect(plan1Prompt).toContain('curly braces');

        // The revision pass carries the previous plan and the chosen revision.
        expect(plan2Prompt).toContain('3. save (llm with a file tool)');
        expect(plan2Prompt).toContain('Make it simpler');

        // The build step sees the approved (latest) plan and the authoring reference,
        // with literal Liquid examples intact (raw blocks survived interpolation).
        expect(buildPrompt).toContain(PLAN_2);
        expect(buildPrompt).toContain('{{ outputs.');
        expect(buildPrompt).toContain('Skill not written:');
        // The tail of the reference (after the example's inner `---` lines) reached the model.
        expect(buildPrompt).toContain('The user asked for a different version');

        // The build step offers skiller_writeSkill and forces it on the first turn.
        const buildOptions = captured.options[2];
        expect(buildOptions.tools?.map(t => t.name)).toEqual(['skiller_writeSkill']);
        expect(buildOptions.toolMode).toBe(vscode.LanguageModelChatToolMode.Required);
        expect(vscode.lm.invokeTool).toHaveBeenCalledWith(
            'skiller_writeSkill',
            expect.objectContaining({ input: { id: 'changelog-writer', files: [] } }),
            expect.anything(),
        );
    });

    it('lists the installed tools in the plan prompt', async () => {
        const skill = loadSkill();
        const captured: Captured = { prompts: [], options: [] };
        const model = makeFakeModel([PLAN_1], captured);
        const executor = new SkillExecutor(createDefaultRegistry(), fakeResolver(model));

        const result = await executor.execute(
            skill,
            makeOptions(new ExecutionStateEmitter(), { idea: IDEA, available_tools: 'jira_search — Search issues' }),
        );

        expect(result.pendingConfirmation?.stepId).toBe('review');
        expect(captured.prompts[0]).toContain('jira_search — Search issues');
    });
});
