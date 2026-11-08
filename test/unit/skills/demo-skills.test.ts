/**
 * Validates that every bundled demo skill parses successfully.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseSkillFromContent } from '../../../src/skills/parser';
import { createMockSkillSource } from '../../helpers/mocks/skill';

const SKILLS_DIR = path.join(__dirname, '../../../skills');
const DEMOS = ['greeter', 'mind-reader', 'skill-creator'];

describe('bundled demo skills', () => {
    const source = createMockSkillSource();

    for (const name of DEMOS) {
        it(`${name} parses successfully`, () => {
            const dir = path.join(SKILLS_DIR, name);
            const yaml = fs.readFileSync(path.join(dir, 'skill.yaml'), 'utf8');
            const result = parseSkillFromContent(yaml, dir, source);
            if (!result.success) {
                throw new Error(`Parse failed for ${name}:\n${result.error.error}`);
            }
            expect(result.success).toBe(true);
        });

        // A pinned model id beats the user's own pick, and providers retire ids
        // per plan (Copilot still lists gpt-4o but refuses it on some plans), so
        // a shipped skill that pins one fails on its first run for those users.
        it(`${name} does not pin a model`, () => {
            const dir = path.join(SKILLS_DIR, name);
            const yaml = fs.readFileSync(path.join(dir, 'skill.yaml'), 'utf8');
            const result = parseSkillFromContent(yaml, dir, source);
            if (!result.success) throw new Error(result.error.error);
            expect(result.skill.models?.default).toBeUndefined();
            expect(result.skill.steps.filter(s => s.model).map(s => s.id)).toEqual([]);
        });
    }
});
