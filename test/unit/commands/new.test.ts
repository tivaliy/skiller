import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../../src/commands/skill/handler', () => ({ runSkillById: vi.fn() }));

import { MarkdownString } from 'vscode';
import { handleNew } from '../../../src/commands/new';
import { formatNewSkillMenu } from '../../../src/commands/presenters';
import * as handlerModule from '../../../src/commands/skill/handler';
import type { CommandContext } from '../../../src/commands/types';
import { useDiskBackedVscodeFs } from '../../helpers/disk-vscode-fs';

function ctxWith(prompt: string): CommandContext {
    return {
        request: { prompt },
        stream: { button: vi.fn(), markdown: vi.fn() },
    } as unknown as CommandContext;
}

describe('handleNew', () => {
    beforeEach(() => {
        vi.mocked(handlerModule.runSkillById).mockResolvedValue({ handled: true });
    });

    it('empty prompt shows the trusted link menu, not buttons', async () => {
        const ctx = ctxWith('   ');
        const result = await handleNew(ctx);
        expect(ctx.stream.button).not.toHaveBeenCalled();
        const markdown = vi.mocked(ctx.stream.markdown);
        expect(markdown).toHaveBeenCalledTimes(1);
        const md = markdown.mock.calls[0][0] as unknown as MarkdownString;
        expect(md).toBeInstanceOf(MarkdownString);
        expect(md.value).toBe(formatNewSkillMenu());
        expect(md.isTrusted).toEqual({ enabledCommands: ['skiller.newSkill'] });
        expect(result.metadata).toEqual({ command: 'new' });
        expect(handlerModule.runSkillById).not.toHaveBeenCalled();
    });

    it('non-empty prompt runs skill-creator with the whole prompt as idea', async () => {
        const ctx = ctxWith('  review my "staged" diff, then fix ');
        await handleNew(ctx);
        expect(handlerModule.runSkillById).toHaveBeenCalledWith(
            ctx, 'skill-creator', { idea: 'review my "staged" diff, then fix' });
    });
});

describe('runSkillById with idea param', () => {
    let dir: string;
    beforeEach(() => {
        useDiskBackedVscodeFs();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'new-test-'));
        const skillDir = path.join(dir, 'skill-creator');
        fs.mkdirSync(path.join(skillDir, 'steps'), { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'steps', '01-go.md'), 'Go {{inputs.idea}}');
        fs.writeFileSync(path.join(skillDir, 'skill.yaml'), `id: skill-creator
name: Skill Creator
description: fixture
version: "1.0.0"
inputs:
  - name: idea
    type: string
    description: idea
    required: false
    prompt: "What should the skill do?"
tools:
  aliases: {}
steps:
  - id: go
    type: llm
    file: steps/01-go.md
    output: out
`);
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('does not re-prompt for the provided idea', async () => {
        const { runSkillById: real } = await vi.importActual<typeof import('../../../src/commands/skill/handler')>(
            '../../../src/commands/skill/handler');
        const skillDir = path.join(dir, 'skill-creator');
        const setPending = vi.fn();
        const execute = vi.fn().mockResolvedValue({
            success: true, steps: [], duration: 0, context: {},
        });
        const ctx = {
            request: { prompt: '' },
            stream: { button: vi.fn(), markdown: vi.fn(), progress: vi.fn() },
            skillRegistry: { getById: () => ({ id: 'skill-creator', source: { type: 'builtin', path: skillDir } }) },
            skillExecutor: { execute },
            toolCache: { getDiscoveredCategories: () => [] },
            pendingStateManager: { setPendingInputCollection: setPending, setPendingConfirmation: vi.fn() },
            executionState: { startExecution: vi.fn(), setTerminalStatus: vi.fn() },
        } as unknown as CommandContext;
        try { await real(ctx, 'skill-creator', { idea: 'review diffs' }); } catch { /* finalize may need more of ctx */ }
        expect(setPending).not.toHaveBeenCalled();
        expect(execute).toHaveBeenCalled();
    });
});
