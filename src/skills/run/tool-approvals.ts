/**
 * Tool-approval policy for native runs.
 *
 * Outside chat, VS Code shows no approval prompt for tool calls, so the engine
 * asks through an approver supplied per run. The policy decides when to ask:
 * once per tool per run, with "always" remembered across runs in an injected
 * store (the extension backs it with workspace state).
 */

import type { ToolApprover } from '../types';
import type { ToolApproval, ToolCallRequest } from './types';

/** Persisted names of tools the user always allows. */
export interface AlwaysAllowedStore {
    get(): string[];
    set(names: string[]): Thenable<void>;
}

export class ToolApprovalPolicy {
    constructor(private readonly store: AlwaysAllowedStore) {}

    /** An approver for one run. `ask` is only called for tools not yet allowed. */
    approverFor(ask: (call: ToolCallRequest) => Promise<ToolApproval>): ToolApprover {
        const allowedForRun = new Set<string>();
        return async call => {
            const { toolName } = call;
            if (allowedForRun.has(toolName) || this.store.get().includes(toolName)) return true;

            const answer = await ask(call);
            switch (answer) {
                case 'run':
                    allowedForRun.add(toolName);
                    return true;
                case 'always':
                    allowedForRun.add(toolName);
                    await this.remember(toolName);
                    return true;
                case 'once':
                    return true;
                default:
                    return false;
            }
        };
    }

    /** Forget every always-allowed tool. */
    async resetAlways(): Promise<void> {
        await this.store.set([]);
    }

    private async remember(toolName: string): Promise<void> {
        const names = this.store.get();
        if (!names.includes(toolName)) await this.store.set([...names, toolName]);
    }
}
