import { describe, it, expect } from 'vitest';
import { resumeAfterChoice } from '../../../../src/skills/run/confirmation';
import type { Skill, ConfirmationOption, ExecutionContext, StepResult } from '../../../../src/skills';

const OPTS: ConfirmationOption[] = [
  { label: 'Go', action: 'continue' },
  { label: 'Revise', action: 'goto', gotoStep: 'draft' },
  { label: 'Lost', action: 'goto', gotoStep: 'nope' },
  { label: 'Stop', action: 'abort' },
];

function skill3(ids: string[], opts: { reviewOutput?: string } = {}): Skill {
  return {
    id: 's', name: 'S', description: '', version: '1.0.0', inputs: [],
    tools: { aliases: {} }, onError: 'abort', source: { type: 'workspace', path: '/s' },
    steps: ids.map(id => ({
      id, type: id === 'review' ? 'confirmation' : 'prompt',
      ...(id === 'review' && opts.reviewOutput ? { output: opts.reviewOutput } : {}),
    })),
  } as unknown as Skill;
}

const ctx = { inputs: {}, outputs: {} } as unknown as ExecutionContext;
const results = [] as StepResult[];
const pending = { stepIndex: 1, stepId: 'review', message: 'm', options: OPTS };
const run = (choice: ConfirmationOption, output?: string) =>
  resumeAfterChoice(skill3(['draft', 'review', 'publish'], { reviewOutput: output }), pending, choice, ctx, results, () => 7);

describe('resumeAfterChoice', () => {
  it('resumes at the goto target and records the choice', () => {
    expect(run(OPTS[1], 'decision')).toEqual({ kind: 'resume', resume: {
      startFromStep: 0, existingContext: ctx, existingStepResults: results,
      recordOutput: { key: 'decision', value: { selectedOption: 'Revise', selectedIndex: 2, action: 'goto', timestamp: 7 } },
      completedStepId: 'review' } });
  });
  it('continues to the next step', () => {
    const r = run(OPTS[0]);
    expect(r).toEqual({ kind: 'resume', resume: {
      startFromStep: 2, existingContext: ctx, existingStepResults: results,
      recordOutput: undefined, completedStepId: 'review' } });
  });
  it('falls back to the next step for an unknown goto target', () => {
    const r = run(OPTS[2]);
    expect(r).toMatchObject({ kind: 'resume', unknownGoto: 'nope', resume: { startFromStep: 2 } });
  });
  it('returns abort for an abort choice', () => {
    expect(run(OPTS[3])).toEqual({ kind: 'abort' });
  });
});
