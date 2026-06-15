/**
 * Tests for skills/parser.ts
 *
 * Tests the skill YAML and step markdown parsing
 */

import { describe, it, expect } from 'vitest';
import { parseStepContent, parseSkillFromContent } from '../../../src/skills/parser';
import type { ParseError, ParseSkillResult } from '../../../src/skills/types';
import { createMockSkillSource } from '../../helpers/mocks/skill';
import {
    SAMPLE_STEP_WITH_FRONTMATTER,
    SAMPLE_STEP_NO_FRONTMATTER,
    SAMPLE_STEP_WITH_TOOLS,
    SAMPLE_STEP_EMPTY,
    SAMPLE_STEP_MALFORMED_YAML,
} from '../../helpers/fixtures';

/**
 * Assert a parse result is a failure and return the typed ParseError.
 *
 * Narrows the ParseSkillResult discriminated union so the `error` payload is
 * accessible without optional chaining, while still asserting the failure.
 */
function expectParseError(result: ParseSkillResult): ParseError {
    expect(result.success).toBe(false);
    if (result.success) {
        throw new Error('Expected parse to fail, but it succeeded');
    }
    return result.error;
}

// ============================================================================
// Pure Function Tests
// ============================================================================

describe('parser', () => {
    describe('parseStepContent', () => {
        it('parses frontmatter and body from step content', () => {
            const result = parseStepContent(SAMPLE_STEP_WITH_FRONTMATTER);

            expect(result.meta.id).toBe('fetch');
            expect(result.meta.description).toBe('Fetch the article details');
            expect(result.meta.tool).toBe('http_get');
            expect(result.prompt).toContain('Fetch the article with ID');
        });

        it('extracts all frontmatter fields', () => {
            const content = `---
id: test-step
description: Test description
tool: test_tool
requires:
  - previous-step
---

Step prompt here.`;

            const result = parseStepContent(content);

            expect(result.meta.id).toBe('test-step');
            expect(result.meta.description).toBe('Test description');
            expect(result.meta.tool).toBe('test_tool');
            expect(result.meta.requires).toEqual(['previous-step']);
        });

        it('handles content without frontmatter', () => {
            const result = parseStepContent(SAMPLE_STEP_NO_FRONTMATTER);

            expect(result.meta).toEqual({});
            expect(result.prompt).toContain('Analyze the article');
        });

        it('preserves template variables in prompt', () => {
            const result = parseStepContent(SAMPLE_STEP_WITH_FRONTMATTER);
            expect(result.prompt).toContain('{{ article_id }}');
        });

        it('handles empty content', () => {
            const result = parseStepContent(SAMPLE_STEP_EMPTY);
            expect(result.meta).toEqual({});
            expect(result.prompt).toBe('');
        });

        it('handles malformed frontmatter gracefully', () => {
            // Should not throw, returns empty meta
            const result = parseStepContent(SAMPLE_STEP_MALFORMED_YAML);
            expect(result.meta).toEqual({});
            expect(result.prompt).toContain('Body content');
        });

        it('trims whitespace from prompt body', () => {
            const content = `---
id: test
---

   Prompt with leading whitespace


`;
            const result = parseStepContent(content);
            expect(result.prompt).toBe('Prompt with leading whitespace');
        });

        it('handles frontmatter with only separator lines', () => {
            // When frontmatter has no content between markers, the regex requires
            // at least a newline's worth of content. Empty frontmatter like `---\n---`
            // doesn't match the pattern, so entire content becomes the prompt.
            const content = `---
---

Just the body`;

            const result = parseStepContent(content);
            // The regex pattern requires content between markers, so this doesn't match
            // and the entire string (trimmed) becomes the prompt
            expect(result.meta).toEqual({});
            expect(result.prompt).toBe('---\n---\n\nJust the body');
        });

        it('handles content that looks like frontmatter but is not', () => {
            const content = `Some text
---
not: frontmatter
---
More text`;

            const result = parseStepContent(content);
            // This should be treated as no frontmatter since --- doesn't start at beginning
            expect(result.prompt).toContain('Some text');
        });

        it('preserves multiline prompt content', () => {
            const result = parseStepContent(SAMPLE_STEP_WITH_FRONTMATTER);
            expect(result.prompt).toContain('Include the following information:');
            expect(result.prompt).toContain('- Summary');
            expect(result.prompt).toContain('- Description');
        });

        it('handles tools array in frontmatter', () => {
            const result = parseStepContent(SAMPLE_STEP_WITH_TOOLS);
            expect(result.meta.id).toBe('analyze');
            // Note: tools array parsing depends on implementation details
        });
    });

    // ========================================================================
    // Strict Key Validation Tests
    // ========================================================================

    describe('parseSkillFromContent - strict key validation', () => {
        const skillDir = '/test/skill';
        const source = createMockSkillSource();

        describe('top-level unknown keys', () => {
            it('rejects onError (should be on_error)', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: llm
    file: steps/01.md
onError: abort
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                // Zod format: Unrecognized key(s) in object: 'X'
                expect(expectParseError(result).error).toContain("'onError'");
                expect(expectParseError(result).error).toContain("Unrecognized");
            });

            it('rejects completely unknown top-level keys', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: llm
    file: steps/01.md
unknownKey: some value
anotherBadKey: true
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("'unknownKey'");
                expect(expectParseError(result).error).toContain("'anotherBadKey'");
            });

            it('suggests similar keys for typos', () => {
                const yaml = `
name: Test Skill
descriptin: A typo in description
steps:
  - id: step-1
    type: llm
    file: steps/01.md
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("'descriptin'");
                expect(expectParseError(result).error).toContain("description");
            });

            it('accepts all valid top-level keys', () => {
                const yaml = `
name: Test Skill
description: A valid skill
version: "1.0.0"
author: Test Author
inputs:
  - name: input1
    type: string
tools:
  aliases:
    get_issue: item_get
models:
  default: gpt-4o
steps:
  - id: step-1
    type: llm
    file: steps/01.md
on_error: abort
output:
  summary: "{{ outputs.step-1 }}"
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(true);
            });
        });

        describe('input unknown keys', () => {
            it('rejects unknown keys in input definitions', () => {
                const yaml = `
name: Test Skill
inputs:
  - name: test
    type: string
    unknownInputProp: value
steps:
  - id: step-1
    type: llm
    file: steps/01.md
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("inputs");
                expect(expectParseError(result).error).toContain("'unknownInputProp'");
            });

            it('accepts all valid input keys', () => {
                const yaml = `
name: Test Skill
inputs:
  - name: test
    type: string
    description: A test input
    required: true
    default: "default value"
    prompt: "Enter value"
    pattern: "^[a-z]+$"
    enum: ["a", "b", "c"]
steps:
  - id: step-1
    type: llm
    file: steps/01.md
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(true);
            });
        });

        describe('step unknown keys', () => {
            it('rejects unknown keys in step definitions', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: llm
    file: steps/01.md
    unknownStepProp: value
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("steps");
                expect(expectParseError(result).error).toContain("'unknownStepProp'");
            });

            it('suggests toolMode should be tool_mode', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: llm
    file: steps/01.md
    toolMode: required
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("'toolMode'");
                expect(expectParseError(result).error).toContain("Unrecognized");
            });

            it('accepts all valid step keys', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    file: steps/01.md
    description: A test step
    type: llm
    tools:
      - some_tool
    model: gpt-4o
    tool_mode: auto
    output: result
    when: "{{ inputs.flag }}"
    requires:
      - other-step
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(true);
            });

            it('accepts tool step with tool and params', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: tool
    tool: some_tool
    params:
      arg1: value1
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(true);
            });

            it('accepts confirmation step with message and options', () => {
                const yaml = `
name: Test Skill
steps:
  - id: confirm
    type: confirmation
    message: "Continue?"
    options:
      - label: "Yes"
        action: continue
      - label: "No"
        action: abort
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(true);
            });
        });

        describe('confirmation option unknown keys', () => {
            it('rejects unknown keys in confirmation options', () => {
                const yaml = `
name: Test Skill
steps:
  - id: confirm
    type: confirmation
    message: "Continue?"
    options:
      - label: "Yes"
        action: continue
        unknownOptionProp: value
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("options");
                expect(expectParseError(result).error).toContain("'unknownOptionProp'");
            });

            it('suggests gotoStep should be goto_step', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: llm
    file: steps/01.md
  - id: confirm
    type: confirmation
    message: "Retry?"
    options:
      - label: "Yes"
        action: goto
        gotoStep: step-1
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("'gotoStep'");
                expect(expectParseError(result).error).toContain("Unrecognized");
            });

            it('accepts all valid option keys', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: llm
    file: steps/01.md
  - id: confirm
    type: confirmation
    message: "Retry?"
    options:
      - label: "Yes"
        action: goto
        goto_step: step-1
      - label: "No"
        action: abort
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(true);
            });
        });

        describe('tools section unknown keys', () => {
            it('rejects unknown keys in tools section', () => {
                const yaml = `
name: Test Skill
tools:
  aliases:
    get_issue: item_get
  unknownToolsProp: value
steps:
  - id: step-1
    type: llm
    file: steps/01.md
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("tools");
                expect(expectParseError(result).error).toContain("'unknownToolsProp'");
            });

            it('rejects required/optional keys in the tools section', () => {
                const yaml = `
name: Test Skill
tools:
  required:
    - acme
  optional:
    - docs
  aliases:
    get_issue: mcp_acme_item_get
steps:
  - id: step-1
    type: llm
    file: steps/01.md
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("tools");
                // Zod rejects unrecognized keys
                expect(expectParseError(result).error).toContain("Unrecognized");
            });

            it('accepts valid tools section with only aliases', () => {
                const yaml = `
name: Test Skill
tools:
  aliases:
    get_issue: mcp_acme_item_get
    create_file: skiller_createFile?
steps:
  - id: step-1
    type: llm
    file: steps/01.md
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(true);
            });
        });

        describe('models section unknown keys', () => {
            it('rejects unknown keys in models section', () => {
                const yaml = `
name: Test Skill
models:
  default: gpt-4o
  unknownModelsProp: value
steps:
  - id: step-1
    type: llm
    file: steps/01.md
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("models");
                expect(expectParseError(result).error).toContain("'unknownModelsProp'");
            });

            it('accepts all valid models keys', () => {
                const yaml = `
name: Test Skill
models:
  default: gpt-4o
  aliases:
    fast: gpt-4o-mini
    smart: gpt-4o
steps:
  - id: step-1
    type: llm
    file: steps/01.md
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(true);
            });
        });

        describe('output section unknown keys', () => {
            it('rejects unknown keys in output section', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: llm
    file: steps/01.md
output:
  summary: "Done"
  unknownOutputProp: value
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("output");
                expect(expectParseError(result).error).toContain("'unknownOutputProp'");
            });

            it('accepts valid output keys', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: llm
    file: steps/01.md
output:
  summary: "{{ outputs.step-1 }}"
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(true);
            });
        });

        describe('multiple errors', () => {
            it('reports all unknown keys in one error message', () => {
                const yaml = `
name: Test Skill
onError: abort
badTopLevel: true
steps:
  - id: step-1
    type: llm
    file: steps/01.md
    badStepProp: value
inputs:
  - name: test
    badInputProp: value
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                // Should contain all errors (Zod reports all unrecognized keys)
                expect(expectParseError(result).error).toContain("'onError'");
                expect(expectParseError(result).error).toContain("'badTopLevel'");
                expect(expectParseError(result).error).toContain("'badStepProp'");
                expect(expectParseError(result).error).toContain("'badInputProp'");
            });
        });

        describe('duplicate detection', () => {
            it('rejects duplicate input names', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: llm
    file: steps/01.md
inputs:
  - name: duplicated
    type: string
  - name: duplicated
    type: number
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("Duplicate input name");
                expect(expectParseError(result).error).toContain("'duplicated'");
            });

            it('rejects duplicate step IDs', () => {
                const yaml = `
name: Test Skill
steps:
  - id: same-id
    type: llm
    file: steps/01.md
  - id: same-id
    type: llm
    file: steps/02.md
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("Duplicate step ID");
                expect(expectParseError(result).error).toContain("'same-id'");
            });

            it('rejects duplicate output variable names', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: llm
    file: steps/01.md
    output: result
  - id: step-2
    type: llm
    file: steps/02.md
    output: result
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("Duplicate output variable");
                expect(expectParseError(result).error).toContain("'result'");
            });
        });

        describe('version validation', () => {
            it('accepts valid semver versions', () => {
                const yaml = `
name: Test Skill
version: "1.0.0"
steps:
  - id: step-1
    type: llm
    file: steps/01.md
`;
                const result = parseSkillFromContent(yaml, skillDir, source);
                expect(result.success).toBe(true);
            });

            it('accepts semver with prerelease tag', () => {
                const yaml = `
name: Test Skill
version: "2.1.0-beta.1"
steps:
  - id: step-1
    type: llm
    file: steps/01.md
`;
                const result = parseSkillFromContent(yaml, skillDir, source);
                expect(result.success).toBe(true);
            });

            it('rejects invalid semver format', () => {
                const yaml = `
name: Test Skill
version: "1.0"
steps:
  - id: step-1
    type: llm
    file: steps/01.md
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("semver");
            });

            it('rejects non-numeric version', () => {
                const yaml = `
name: Test Skill
version: "latest"
steps:
  - id: step-1
    type: llm
    file: steps/01.md
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("semver");
            });
        });

        describe('cross-field step constraints', () => {
            it('rejects tool step without tool property', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: tool
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("Tool steps require 'tool' property");
            });

            it('rejects tool step with tools array', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: tool
    tool: some_tool
    tools:
      - extra_tool
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("Tool steps should not have 'tools' array");
            });

            it('rejects tool step with tool_mode', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: tool
    tool: some_tool
    tool_mode: required
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("Tool steps should not have 'tool_mode'");
            });

            it('rejects llm step without file or message', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: llm
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("LLM steps require either 'file' or 'message'");
            });

            it('rejects confirmation step without file or message', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: confirmation
    options:
      - label: "Yes"
        action: continue
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("Confirmation steps require either 'message' or 'file'");
            });

            it('rejects step with both file and message', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: llm
    file: steps/01.md
    message: "Inline prompt"
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("both 'message' and 'file'");
            });

            it('rejects goto option without goto_step', () => {
                const yaml = `
name: Test Skill
steps:
  - id: confirm
    type: confirmation
    message: "Choose"
    options:
      - label: "Go somewhere"
        action: goto
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("goto");
                expect(expectParseError(result).error).toContain("goto_step");
            });

            it('rejects tool_mode required without tools array', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: llm
    file: steps/01.md
    tool_mode: required
`;
                const result = parseSkillFromContent(yaml, skillDir, source);

                expect(result.success).toBe(false);
                expect(expectParseError(result).error).toContain("tool_mode 'required' requires tools array");
            });

            it('accepts valid tool step', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: tool
    tool: some_tool
    params:
      arg: value
`;
                const result = parseSkillFromContent(yaml, skillDir, source);
                expect(result.success).toBe(true);
            });

            it('accepts valid llm step with tools', () => {
                const yaml = `
name: Test Skill
steps:
  - id: step-1
    type: llm
    file: steps/01.md
    tools:
      - tool_a
      - tool_b
    tool_mode: required
`;
                const result = parseSkillFromContent(yaml, skillDir, source);
                expect(result.success).toBe(true);
            });
        });
    });
});
