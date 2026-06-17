/**
 * End-to-end workflow test for the bundled `mind-reader` skill.
 *
 * Drives the REAL skill (skills/mind-reader/*) through its full
 * ask → answer(goto ask) → ask → answer(goto guess) → guess → verdict loop
 * with a fake language model, and asserts that on the SECOND `ask` turn the
 * prompt the model receives carries forward the previous notes AND the player's
 * answer. This is exactly the loop-carried state the resume bug used to wipe —
 * with the old behavior turn 2 would fall back to the "first question" branch
 * and the game could never converge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SkillExecutor } from '../../../src/skills/SkillExecutor';
import { createDefaultRegistry } from '../../../src/skills/handlers';
import { ExecutionStateEmitter } from '../../../src/skills/execution-state';
import { parseSkillFromContent, type ParseSkillResult } from '../../../src/skills/parser';
import type { ModelResolver } from '../../../src/skills/model-resolver';
import type { ExecutionOptions, Skill, ResolvedModel } from '../../../src/skills/types';

const MIND_READER_DIR = path.join(__dirname, '../../../skills/mind-reader');

/** Fake model: streams the Nth canned JSON response and records each rendered prompt. */
function makeFakeModel(responses: string[], capturedPrompts: string[]): vscode.LanguageModelChat {
    let call = 0;
    return {
        id: 'fake-model',
        sendRequest: vi.fn(async (messages: vscode.LanguageModelChatMessage[]) => {
            // The runner sends a single User(prompt) message; content is the rendered prompt.
            capturedPrompts.push(String(messages[messages.length - 1].content));
            const text = responses[Math.min(call, responses.length - 1)];
            call++;
            return {
                stream: (async function* () { yield new vscode.LanguageModelTextPart(text); })(),
                text: (async function* () { /* unused */ })(),
            };
        }),
    } as unknown as vscode.LanguageModelChat;
}

/** Resolver that always hands back our fake model, regardless of skill/step config. */
function fakeResolver(model: vscode.LanguageModelChat): ModelResolver {
    const resolved: ResolvedModel = {
        model,
        displayName: 'fake-model',
        source: 'auto',
        usedFallback: false,
    };
    return {
        resolve: async () => resolved,
        listModels: async () => [],
        extractDisplayName: () => 'fake-model',
    } as unknown as ModelResolver;
}

function makeOptions(executionState: ExecutionStateEmitter): ExecutionOptions {
    return {
        inputs: { category: 'something — an object, animal, person, or place' },
        model: { id: 'fake-model' } as unknown as ExecutionOptions['model'],
        isAutoMode: true,
        token: { isCancellationRequested: false } as unknown as ExecutionOptions['token'],
        stream: undefined,
        availableMcps: [],
        executionState,
    };
}

describe('mind-reader workflow (end-to-end with fake LLM)', () => {
    beforeEach(() => {
        // Point the mocked workspace filesystem at the real skill files on disk,
        // so the executor renders the actual steps/*.md Liquid templates.
        vi.mocked(vscode.workspace.fs.readFile).mockImplementation(
            async (uri: vscode.Uri) => new Uint8Array(fs.readFileSync(uri.fsPath))
        );
        // Resolve settings (maxToolIterations, timeouts, …) to their declared
        // defaults — getSetting() passes the default as config.get(key, default).
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: (_key: string, def?: unknown) => def,
            update: vi.fn(),
            has: vi.fn(),
            inspect: vi.fn(),
        } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>);
    });

    it('carries notes + the previous answer forward across the ask→ask loop, then guesses', async () => {
        const yaml = fs.readFileSync(path.join(MIND_READER_DIR, 'skill.yaml'), 'utf8');
        const parsed: ParseSkillResult = parseSkillFromContent(yaml, MIND_READER_DIR, {
            type: 'builtin',
            path: MIND_READER_DIR,
        });
        if (!parsed.success) {
            throw new Error(`mind-reader failed to parse: ${parsed.error.error}`);
        }
        const skill: Skill = parsed.skill;

        const capturedPrompts: string[] = [];
        const model = makeFakeModel(
            [
                // turn 1 (ask)
                '{"notes":"- it is not an animal","question":"Is it man-made?"}',
                // turn 2 (ask) — must be produced WITH the prior notes + answer in context
                '{"notes":"- it is not an animal\\n- it is not man-made","question":"Is it found in nature?"}',
                // guess
                '{"guess":"a mountain","why":"natural and not an animal"}',
            ],
            capturedPrompts
        );

        const executionState = new ExecutionStateEmitter();
        const executor = new SkillExecutor(createDefaultRegistry(), fakeResolver(model));
        const opts = () => makeOptions(executionState);

        // 1. Initial run: ask (turn 1) → pauses at the `answer` confirmation.
        let result = await executor.execute(skill, opts());
        expect(result.pendingConfirmation?.stepId).toBe('answer');

        // 2. Player answers "No" → goto ask. Mirrors what the confirmation responder does.
        result = await executor.execute(skill, opts(), {
            startFromStep: skill.steps.findIndex(s => s.id === 'ask'),
            existingContext: result.context,
            existingStepResults: result.steps,
            completedStepId: 'answer',
            recordOutput: {
                key: 'reply',
                value: { selectedOption: 'No', selectedIndex: 2, action: 'goto', timestamp: 0 },
            },
        });
        expect(result.pendingConfirmation?.stepId).toBe('answer');

        // 3. Player picks "guess now" → goto guess → pauses at `verdict`.
        result = await executor.execute(skill, opts(), {
            startFromStep: skill.steps.findIndex(s => s.id === 'guess'),
            existingContext: result.context,
            existingStepResults: result.steps,
            completedStepId: 'answer',
            recordOutput: {
                key: 'reply',
                value: { selectedOption: "I'm ready — guess now!", selectedIndex: 4, action: 'goto', timestamp: 0 },
            },
        });
        expect(result.pendingConfirmation?.stepId).toBe('verdict');

        // 4. Player confirms the guess (continue) → skill finishes.
        result = await executor.execute(skill, opts(), {
            startFromStep: skill.steps.findIndex(s => s.id === 'verdict') + 1,
            existingContext: result.context,
            existingStepResults: result.steps,
            completedStepId: 'verdict',
            recordOutput: {
                key: 'result',
                value: { selectedOption: 'Yes! 🎉 You got it', selectedIndex: 1, action: 'continue', timestamp: 0 },
            },
        });
        expect(result.success).toBe(true);
        expect(result.pendingConfirmation).toBeUndefined();

        // --- The crux: what did the model actually see each turn? ---
        const [askTurn1, askTurn2, guessPrompt] = capturedPrompts;

        // Turn 1 starts broad (no prior state yet).
        expect(askTurn1).toContain('This is your very first question');

        // Turn 2 MUST carry the prior notes, the prior question, and the answer —
        // and must NOT have fallen back to the "first question" branch.
        expect(askTurn2).not.toContain('This is your very first question');
        expect(askTurn2).toContain('it is not an animal');     // prior notes
        expect(askTurn2).toContain('Is it man-made?');         // prior question
        expect(askTurn2).toContain('No');                      // player's answer

        // The guess step sees the accumulated notes too.
        expect(guessPrompt).toContain('it is not man-made');

        // Final guess threaded through to outputs.
        expect((result.context.outputs.final as { guess: string }).guess).toBe('a mountain');
    });
});
