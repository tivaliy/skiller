import { describe, it, expect } from 'vitest';
import { parseSkillFromContent } from '../../../../src/skills/parser';

const SOURCE = { type: 'workspace' as const, path: '/skills/t' };

const YAML = `
id: t
name: T
inputs:
  - name: code
    type: string
    from: selection
steps:
  - id: s
    type: llm
    message: "{{ inputs.code }}"
`;

describe('input.from field', () => {
  it('accepts and passes through the from: binding', () => {
    const result = parseSkillFromContent(YAML, '/skills/t', SOURCE);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.skill.inputs[0].from).toBe('selection');
  });

  it('leaves from undefined when not specified', () => {
    const yaml = YAML.replace('    from: selection\n', '');
    const result = parseSkillFromContent(yaml, '/skills/t', SOURCE);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.skill.inputs[0].from).toBeUndefined();
  });

  it('rejects an unknown from: source (typo caught at parse)', () => {
    const yaml = YAML.replace('from: selection', 'from: slection');
    const result = parseSkillFromContent(yaml, '/skills/t', SOURCE);
    expect(result.success).toBe(false);
  });
});
