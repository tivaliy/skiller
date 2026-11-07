import { describe, it, expect, vi, afterEach } from 'vitest';
import { RunSkillTool, type RunSkillDeps } from '../../../src/tools/run-skill';
import type { Skill, SkillResult } from '../../../src/skills/types';
import type { RunOutcome } from '../../../src/skills/run/types';

function textOf(result: { content: unknown[] }): string {
    return result.content.map(p => (p as { value: string }).value).join('');
}

const skill = {
    id: 'rewrite', name: 'Rewrite', description: 'd', inputs: [
        { name: 'text', type: 'string', description: 'Text', required: true },
        { name: 'tone', type: 'string', description: 'Tone', required: false }
    ],
    output: { summary: 's', to: 'replaceSelection' },
    tools: { aliases: {} }, steps: [], source: { type: 'workspace', path: '/ws/rewrite' }
} as unknown as Skill;
const other = { ...skill, id: 'other', name: 'Other' } as Skill;

const notCancelled = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as never;
const completed = (over: Partial<SkillResult> = {}): RunOutcome => ({
    kind: 'completed', result: { success: true, summary: 'All done', ...over } as SkillResult, delivery: { kind: 'none' }
});

function make(run: RunSkillDeps['run'] = async () => completed()) {
    const deps: RunSkillDeps = {
        find: id => [skill, other].find(s => s.id === id),
        ids: () => [skill.id, other.id],
        run: vi.fn(run),
        captureTarget: vi.fn(() => undefined),
        newCancellation: () => {
            const listeners: Array<() => void> = [];
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: (l: () => void) => { listeners.push(l); return { dispose() {} }; }
            };
            return { token, cancel: () => { token.isCancellationRequested = true; listeners.forEach(l => l()); }, dispose: vi.fn() } as never;
        },
        waitCapMs: 600_000
    };
    return { deps, tool: new RunSkillTool(deps) };
}

afterEach(() => vi.useRealTimers());

describe('RunSkillTool', () => {
    it('always asks for confirmation listing the inputs', async () => {
        const { tool } = make();
        const prepared = await tool.prepareInvocation({ input: { id: 'rewrite', inputs: { text: 'hi' } } } as never, notCancelled);
        expect(prepared!.invocationMessage).toBe('Running Skiller skill Rewrite…');
        expect(prepared!.confirmationMessages!.title).toBe('Run Skiller skill');
        const msg = (prepared!.confirmationMessages!.message as { value: string }).value;
        expect(msg).toContain('Run **Rewrite**?');
        expect(msg).toContain('text');
        expect(msg).toContain('hi');
    });

    it('still asks for confirmation for an unknown id', async () => {
        const { tool } = make();
        const prepared = await tool.prepareInvocation({ input: { id: 'nope' } } as never, notCancelled);
        expect(prepared!.confirmationMessages).toBeDefined();
    });

    it('returns the run summary when the run completes', async () => {
        const { deps, tool } = make();
        const text = textOf(await tool.invoke({ input: { id: 'rewrite', inputs: { text: 'hi' } } } as never, notCancelled));
        expect(text).toContain('All done');
        const req = vi.mocked(deps.run).mock.calls[0][0];
        expect(req.skill).toBe(skill);
        expect(req.inputs).toEqual({ text: 'hi' });
        expect(deps.captureTarget).toHaveBeenCalledWith(skill);
    });

    it('reports a failed skill as a failure, not a success', async () => {
        const { tool } = make(async () => completed({ success: false, error: 'boom', summary: 'partial' }));
        const text = textOf(await tool.invoke({ input: { id: 'rewrite' } } as never, notCancelled));
        expect(text).toBe('The skill failed: boom');
    });

    it('maps cancelled, failed and notStarted outcomes to text', async () => {
        const cases: Array<[RunOutcome, string]> = [
            [{ kind: 'cancelled' }, 'The run was cancelled.'],
            [{ kind: 'failed', message: 'bad' }, 'bad'],
            [{ kind: 'notStarted', reason: 'busy' }, 'busy']
        ];
        for (const [outcome, expected] of cases) {
            const { tool } = make(async () => outcome);
            expect(textOf(await tool.invoke({ input: { id: 'rewrite' } } as never, notCancelled))).toBe(expected);
        }
    });

    it('returns the continue-in-VS-Code text after the cap without cancelling the run', async () => {
        vi.useFakeTimers();
        let runToken: { isCancellationRequested: boolean } | undefined;
        const { tool } = make(req => { runToken = req.token; return new Promise(() => {}); });
        const pending = tool.invoke({ input: { id: 'rewrite' } } as never, notCancelled);
        await vi.advanceTimersByTimeAsync(600_000);
        expect(textOf(await pending)).toBe('The run continues in VS Code; see the graph panel for the result.');
        expect(runToken!.isCancellationRequested).toBe(false);
    });

    function cancellableToken() {
        const t = {
            isCancellationRequested: false,
            listeners: [] as Array<() => void>,
            onCancellationRequested: (l: () => void) => {
                t.listeners.push(l);
                return { dispose() { t.listeners = t.listeners.filter(x => x !== l); } };
            },
            cancel() { t.isCancellationRequested = true; [...t.listeners].forEach(l => l()); }
        };
        return t;
    }

    it('cancelling the tool token before the cap cancels the run', async () => {
        const toolToken = cancellableToken();
        const { tool } = make(req => new Promise<RunOutcome>(resolve => {
            req.token!.onCancellationRequested(() => resolve({ kind: 'cancelled' }));
        }));
        const pending = tool.invoke({ input: { id: 'rewrite' } } as never, toolToken as never);
        await Promise.resolve();
        toolToken.cancel();
        expect(textOf(await pending)).toBe('The run was cancelled.');
    });

    it('cancelling the tool token after the cap does not cancel the run', async () => {
        vi.useFakeTimers();
        const toolToken = cancellableToken();
        let runToken: { isCancellationRequested: boolean } | undefined;
        const { tool } = make(req => { runToken = req.token; return new Promise(() => {}); });
        const pending = tool.invoke({ input: { id: 'rewrite' } } as never, toolToken as never);
        await vi.advanceTimersByTimeAsync(600_000);
        await pending;
        toolToken.cancel();
        expect(runToken!.isCancellationRequested).toBe(false);
    });

    it('clears the timer and the token subscription when the run completes first', async () => {
        vi.useFakeTimers();
        const toolToken = cancellableToken();
        const { tool } = make();
        await tool.invoke({ input: { id: 'rewrite' } } as never, toolToken as never);
        expect(vi.getTimerCount()).toBe(0);
        expect(toolToken.listeners).toHaveLength(0);
    });

    it('unknown id returns the list of valid ids', async () => {
        const { deps, tool } = make();
        const text = textOf(await tool.invoke({ input: { id: 'nope' } } as never, notCancelled));
        expect(text).toContain('nope');
        expect(text).toContain('rewrite');
        expect(text).toContain('other');
        expect(deps.run).not.toHaveBeenCalled();
    });

    it('never throws when the run rejects', async () => {
        const { tool } = make(async () => { throw new Error('kaput'); });
        expect(textOf(await tool.invoke({ input: { id: 'rewrite' } } as never, notCancelled))).toContain('kaput');
    });
});

describe('RunSkillTool confirmation text', () => {
    const messageFor = async (input: unknown) => {
        const { tool } = make();
        const prepared = await tool.prepareInvocation({ input } as never, notCancelled);
        return (prepared!.confirmationMessages!.message as { value: string }).value;
    };

    it('shows link syntax, newlines and backticks verbatim inside one code block', async () => {
        const evil = '[README.md](x "rm -rf ~")\n\nRun **Other**?';
        const msg = await messageFor({ id: 'rewrite', inputs: { text: evil, 'k`ey': 'v```v' } });
        const fence = msg.match(/^(`{3,})json$/m)![1];
        const body = msg.split(`${fence}json\n`)[1].split(`\n${fence}`)[0];
        expect(JSON.parse(body)).toEqual({ text: evil, 'k`ey': 'v```v' });
        expect(fence.length).toBeGreaterThan(3);
        // Nothing of the input appears outside the code block.
        const outside = msg.replace(`${fence}json\n${body}\n${fence}`, '');
        expect(outside).not.toContain('README');
        expect(outside).not.toContain('Other');
        expect(outside).toContain('Run');
    });

    it('does not interpret an unknown id as markdown', async () => {
        const msg = await messageFor({ id: '[x](y)**' });
        expect(msg).not.toContain('[x](y)**');
    });
});
