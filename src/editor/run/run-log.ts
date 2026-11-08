/**
 * The run log: a plain-text transcript of one native run — inputs, each step with
 * its model, duration and a one-line output, tool calls, the answers given on
 * cards, and how the run ended. It is what the @skiller chat transcript used to
 * show; the surface writes it to the Skiller output channel.
 *
 * Pure (no vscode): the surface supplies `write`.
 */

export interface RunLogDeps {
    write(line: string): void;
    now?: () => Date;
}

/** Why a step runs on its model, already worded for people. */
export interface LoggedModel {
    model: string;
    why: string;
}

const HEADER_WIDTH = 60;
const OUTPUT_MAX = 100;
const INPUT_MAX = 60;

export class RunLog {
    private ended = false;

    constructor(private readonly skillName: string, private readonly deps: RunLogDeps) {}

    start(inputs: Record<string, unknown>): void {
        const time = (this.deps.now?.() ?? new Date()).toLocaleTimeString('en-GB', { hour12: false });
        const head = `── ${this.skillName} · ${time} `;
        this.write(head + '─'.repeat(Math.max(3, HEADER_WIDTH - head.length)));
        const entries = Object.entries(inputs);
        if (entries.length > 0) {
            this.write(`inputs: ${entries.map(([name, value]) => `${name} = ${formatInput(value)}`).join(', ')}`);
        }
    }

    stepStarted(stepId: string, index: number, total: number, model?: LoggedModel): void {
        const via = model ? ` · model ${model.model} (${model.why})` : '';
        this.write(`▶ ${stepId} (${index + 1}/${total})${via}`);
    }

    stepCompleted(stepId: string, success: boolean, durationMs: number, error?: string, output?: unknown): void {
        if (!success) {
            this.write(`  ✗ ${stepId} ${seconds(durationMs)}${error ? `: ${error}` : ''}`);
            return;
        }
        const text = oneLine(output, OUTPUT_MAX);
        this.write(`  ✓ ${stepId} ${seconds(durationMs)}${text ? ` → ${text}` : ''}`);
    }

    stepSkipped(stepId: string, index: number, total: number, reason: string): void {
        this.write(`↷ ${stepId} (${index + 1}/${total}) skipped: ${reason}`);
    }

    /** A tool call's outcome inside a step ("Called x", "Declined: x", …). */
    toolEvent(text: string): void {
        this.write(`  · ${text}`);
    }

    /** An answer given on a card: a confirmation's choice or a tool approval. */
    answered(question: string, answer: string): void {
        this.write(`  ? ${question} → ${answer}`);
    }

    completed(durationMs: number): void {
        this.end(`✓ ${this.skillName} completed in ${seconds(durationMs)}`);
    }

    failed(error: string): void {
        this.end(`✗ ${this.skillName} failed: ${error}`);
    }

    /** The run ended without a result (cancelled, an "abort" choice, or an error). No-op once ended. */
    stopped(cancelled: boolean): void {
        this.end(`■ ${this.skillName} ${cancelled ? 'cancelled' : 'stopped'}`);
    }

    private end(line: string): void {
        if (this.ended) return;
        this.ended = true;
        this.write(line);
        this.write('');
    }

    private write(line: string): void {
        this.deps.write(line);
    }
}

function seconds(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

/** A value on one line, cut to `max` characters ('' for nothing worth showing). Never throws. */
function oneLine(value: unknown, max: number): string {
    if (value === undefined || value === null) return '';
    // Cut before flattening: only `max` characters survive, however large the value.
    const flat = describe(value).slice(0, max * 4).replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Text for a step's output: strings as they are, a tool result's text parts, else JSON. */
function describe(value: unknown): string {
    if (typeof value === 'string') return value;
    const parts = (value as { content?: unknown }).content;
    if (Array.isArray(parts)) {
        // A tool result: show its text; images and other data parts are only counted.
        const texts = parts.map(part => (part as { value?: unknown })?.value).filter((t): t is string => typeof t === 'string');
        if (texts.length > 0) return texts.join(' ');
        return `[${parts.length} non-text part${parts.length === 1 ? '' : 's'}]`;
    }
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return '[output that cannot be shown]'; // cycles, BigInt
    }
}

function formatInput(value: unknown): string {
    return typeof value === 'string' ? `"${oneLine(value, INPUT_MAX)}"` : oneLine(value, INPUT_MAX);
}
