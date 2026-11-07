import { describe, it, expect, vi } from 'vitest';
import { finalizeSkillRun } from '../../../../src/commands/skill/finalize';
import type { CommandContext } from '../../../../src/commands/types';
import type { Skill, SkillResult } from '../../../../src/skills';
import * as skills from '../../../../src/skills';

function skill(to?: string): Skill {
  return {
    id: 't', name: 'T', description: '', version: '1.0.0',
    inputs: [], tools: { aliases: {} }, steps: [], onError: 'abort',
    output: to ? { summary: '...', to } : { summary: '...' },
    source: { type: 'workspace', path: '/t' },
  } as Skill;
}

function result(summary?: string): SkillResult {
  return { skillId: 't', success: true, steps: [], context: { inputs: {}, outputs: {} } as never, duration: 1, summary } as SkillResult;
}

function fakeCtx() {
  const md: string[] = [];
  const finishExecution = vi.fn();
  const ctx = {
    stream: { markdown: (s: string) => { md.push(s); } },
    executionState: { finishExecution },
  } as unknown as CommandContext;
  return { ctx, md, finishExecution };
}

describe('finalizeSkillRun', () => {
  it('says the output opened in a new tab when the editor sink had nowhere safe to write', async () => {
    const spy = vi.spyOn(skills, 'deliverSkillOutput')
      .mockResolvedValue({ kind: 'delivered', sink: { kind: 'insert' }, fellBack: true });
    try {
      const { ctx, md } = fakeCtx();
      await finalizeSkillRun(ctx, skill('editor.insert'), result('PRIVIT'));
      const all = md.join('');
      expect(all).toContain('new tab');
      expect(all).not.toContain('inserted at the cursor');
    } finally {
      spy.mockRestore();
    }
  });

  it('echoes the summary as a fallback when the sink is unrecognized, so the output is not lost', async () => {
    const { ctx, md, finishExecution } = fakeCtx();
    await finalizeSkillRun(ctx, skill('bogus'), result('THE GENERATED OUTPUT'));
    const all = md.join('');
    expect(all).toContain('not a recognized sink');  // the warning still shows
    expect(all).toContain('THE GENERATED OUTPUT');    // and the content is recoverable in chat
    expect(finishExecution).toHaveBeenCalledWith('t', true);
  });

  it('does not echo a fallback when there is no summary to recover', async () => {
    const { ctx, md } = fakeCtx();
    await finalizeSkillRun(ctx, skill('bogus'), result(undefined));
    const all = md.join('');
    expect(all).toContain('not a recognized sink');
    // nothing else to show
    expect(all).not.toContain('undefined');
  });
});
