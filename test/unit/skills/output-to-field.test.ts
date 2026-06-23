import { describe, it, expect } from 'vitest';
import { parseSkillFromContent } from '../../../src/skills/parser';

const SOURCE = { type: 'workspace' as const, path: '/skills/t' };

const YAML = `
id: t
name: T
steps:
  - id: s
    type: llm
    message: "hi"
    output: result
output:
  summary: "{{ outputs.result }}"
  to: newDocument
`;

describe('output.to field', () => {
  it('accepts and passes through the output sink target', () => {
    const result = parseSkillFromContent(YAML, '/skills/t', SOURCE);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.skill.output?.to).toBe('newDocument');
  });

  it('leaves to undefined when not specified', () => {
    const yaml = YAML.replace('  to: newDocument\n', '');
    const result = parseSkillFromContent(yaml, '/skills/t', SOURCE);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.skill.output?.to).toBeUndefined();
  });

  it('rejects an unrecognized sink (typo caught at parse)', () => {
    const yaml = YAML.replace('to: newDocument', 'to: editor.replaceSelecton');
    const result = parseSkillFromContent(yaml, '/skills/t', SOURCE);
    expect(result.success).toBe(false);
  });

  it('accepts a templated file path', () => {
    const yaml = YAML.replace('to: newDocument', 'to: "file:out/{{ outputs.result }}.md"');
    const result = parseSkillFromContent(yaml, '/skills/t', SOURCE);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.skill.output?.to).toBe('file:out/{{ outputs.result }}.md');
  });
});
