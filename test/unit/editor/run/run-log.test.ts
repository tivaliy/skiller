/**
 * The run log: a plain-text transcript of a native run, written to the Skiller
 * output channel (what the @skiller chat transcript used to show).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RunLog } from '../../../../src/editor/run/run-log';

describe('RunLog', () => {
    let lines: string[];
    let log: RunLog;

    beforeEach(() => {
        lines = [];
        log = new RunLog('Greeter', { write: line => lines.push(line), now: () => new Date(2026, 10, 8, 18, 0, 42) });
    });

    it('writes a full run as a readable transcript', () => {
        log.start({ name: 'John' });
        log.stepStarted('greet', 0, 3, { model: 'gpt-5.6-luna', why: 'your model for Skiller runs' });
        log.stepCompleted('greet', true, 2100, undefined, 'Hi John,\nwishing you a wonderful day!');
        log.stepStarted('confirm', 1, 3);
        log.answered('Greeting Ready', 'Yes, give me a fun fact');
        log.stepStarted('fact', 2, 3, { model: 'gpt-5.6-luna', why: 'your model for Skiller runs' });
        log.toolEvent('Called mytool');
        log.stepCompleted('fact', true, 1840, undefined, { fact: 'John means "God is gracious"' });
        log.completed(6400);

        expect(lines).toEqual([
            '── Greeter · 18:00:42 ' + '─'.repeat(38),
            'inputs: name = "John"',
            '▶ greet (1/3) · model gpt-5.6-luna (your model for Skiller runs)',
            '  ✓ greet 2.1s → Hi John, wishing you a wonderful day!',
            '▶ confirm (2/3)',
            '  ? Greeting Ready → Yes, give me a fun fact',
            '▶ fact (3/3) · model gpt-5.6-luna (your model for Skiller runs)',
            '  · Called mytool',
            '  ✓ fact 1.8s → {"fact":"John means \\"God is gracious\\""}',
            '✓ Greeter completed in 6.4s',
            '',
        ]);
    });

    it('cuts long outputs and inputs to one line', () => {
        log.start({ code: 'x'.repeat(200), n: 3, empty: '' });
        log.stepCompleted('draft', true, 50, undefined, 'y'.repeat(300));
        expect(lines[1]).toBe(`inputs: code = "${'x'.repeat(59)}…", n = 3, empty = ""`);
        expect(lines[2]).toBe(`  ✓ draft 0.1s → ${'y'.repeat(99)}…`);
    });

    it('never throws on output it cannot print, and summarizes non-text tool results', () => {
        const cyclic: Record<string, unknown> = { a: 1 };
        cyclic.self = cyclic;
        const image = { content: [{ mimeType: 'image/png', data: new Uint8Array(500_000) }] };
        const mixed = { content: [{ value: 'found 3 files' }, { mimeType: 'image/png', data: new Uint8Array(4) }] };

        log.stepCompleted('a', true, 0, undefined, cyclic);
        log.stepCompleted('b', true, 0, undefined, image);
        log.stepCompleted('c', true, 0, undefined, mixed);
        log.stepCompleted('d', true, 0, undefined, 10n);

        expect(lines).toEqual([
            '  ✓ a 0.0s → [output that cannot be shown]',
            '  ✓ b 0.0s → [1 non-text part]',
            '  ✓ c 0.0s → found 3 files',
            '  ✓ d 0.0s → [output that cannot be shown]',
        ]);
    });

    it('omits the inputs line when there are none, and the arrow when a step produced nothing', () => {
        log.start({});
        log.stepCompleted('gate', true, 0, undefined, undefined);
        log.stepCompleted('blank', true, 0, undefined, '   ');
        expect(lines.slice(1)).toEqual(['  ✓ gate 0.0s', '  ✓ blank 0.0s']);
    });

    it('logs failed and skipped steps and a failed run', () => {
        log.stepCompleted('fetch', false, 300, "Model 'gpt-4o' failed in step 'fetch': quota exceeded");
        log.stepSkipped('polish', 2, 4, 'when: false');
        log.failed("Model 'gpt-4o' failed in step 'fetch': quota exceeded");
        expect(lines).toEqual([
            "  ✗ fetch 0.3s: Model 'gpt-4o' failed in step 'fetch': quota exceeded",
            '↷ polish (3/4) skipped: when: false',
            "✗ Greeter failed: Model 'gpt-4o' failed in step 'fetch': quota exceeded",
            '',
        ]);
    });

    it('marks a run that ended without a result as cancelled or stopped, once', () => {
        log.stopped(true);
        expect(lines).toEqual(['■ Greeter cancelled', '']);

        const other: string[] = [];
        const aborted = new RunLog('Greeter', { write: line => other.push(line) });
        aborted.stopped(false);
        aborted.stopped(false);
        expect(other).toEqual(['■ Greeter stopped', '']);
    });

    it('does not mark a run stopped after its result was logged', () => {
        log.completed(10);
        log.stopped(false);
        expect(lines).toEqual(['✓ Greeter completed in 0.0s', '']);
    });
});
