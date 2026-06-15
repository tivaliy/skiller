/**
 * Validates that every bundled demo skill parses successfully.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseSkillFromContent } from '../../../src/skills/parser';
import { createMockSkillSource } from '../../helpers/mocks/skill';

const SKILLS_DIR = path.join(__dirname, '../../../skills');
const DEMOS = ['greeter', 'mind-reader'];

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
    }
});
