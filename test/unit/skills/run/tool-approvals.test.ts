import { describe, it, expect, vi } from 'vitest';
import { ToolApprovalPolicy } from '../../../../src/skills/run/tool-approvals';
import type { ToolApproval, ToolCallRequest } from '../../../../src/skills/run/types';

function memoryStore(initial: string[] = []) {
    let names = initial;
    return { get: () => names, set: async (n: string[]) => { names = n; } };
}

const call = (toolName: string): ToolCallRequest => ({ toolName, input: {} });

describe('ToolApprovalPolicy', () => {
    it('asks once per tool per run when allowed for the run', async () => {
        const policy = new ToolApprovalPolicy(memoryStore());
        const ask = vi.fn(async (): Promise<ToolApproval> => 'run');
        const approve = policy.approverFor(ask);
        expect(await approve(call('t1'))).toBe(true);
        expect(await approve(call('t1'))).toBe(true);
        expect(ask).toHaveBeenCalledTimes(1);
        await approve(call('t2'));
        expect(ask).toHaveBeenCalledTimes(2);

        await policy.approverFor(ask)(call('t1'));
        expect(ask).toHaveBeenCalledTimes(3);
    });

    it('remembers always-allowed tools across runs and can reset them', async () => {
        const policy = new ToolApprovalPolicy(memoryStore());
        const ask = vi.fn(async (): Promise<ToolApproval> => 'always');
        await policy.approverFor(ask)(call('t1'));
        expect(ask).toHaveBeenCalledTimes(1);

        expect(await policy.approverFor(ask)(call('t1'))).toBe(true);
        expect(ask).toHaveBeenCalledTimes(1);

        await policy.resetAlways();
        await policy.approverFor(ask)(call('t1'));
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it('asks again after a one-off allow', async () => {
        const policy = new ToolApprovalPolicy(memoryStore());
        const ask = vi.fn(async (): Promise<ToolApproval> => 'once');
        const approve = policy.approverFor(ask);
        expect(await approve(call('t1'))).toBe(true);
        await approve(call('t1'));
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it('returns false on deny and asks again next time', async () => {
        const policy = new ToolApprovalPolicy(memoryStore());
        const ask = vi.fn(async (): Promise<ToolApproval> => 'deny');
        const approve = policy.approverFor(ask);
        expect(await approve(call('t1'))).toBe(false);
        await approve(call('t1'));
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it('honours tools already stored as always-allowed', async () => {
        const policy = new ToolApprovalPolicy(memoryStore(['t1']));
        const ask = vi.fn(async (): Promise<ToolApproval> => 'deny');
        expect(await policy.approverFor(ask)(call('t1'))).toBe(true);
        expect(ask).not.toHaveBeenCalled();
    });

    it('does not store an always-allowed tool twice', async () => {
        const store = memoryStore();
        const policy = new ToolApprovalPolicy(store);
        await policy.approverFor(async () => 'always')(call('t1'));
        await policy.approverFor(async () => 'always')(call('t2'));
        expect(store.get()).toEqual(['t1', 't2']);
    });
});
