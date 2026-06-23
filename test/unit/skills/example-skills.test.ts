/**
 * Validates the dogfood example skills under .skiller/skills/ (the maintainer
 * workspace dir, excluded from the .vsix). These exercise the editor-native
 * features (from:, output.to, multi-step graphs); this test keeps them parseable
 * against the schema and ensures their referenced step files exist.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseSkillFromContent } from '../../../src/skills/parser';
import { createMockSkillSource } from '../../helpers/mocks/skill';

const SKILLER_SKILLS = path.join(__dirname, '../../../.skiller/skills');

function exampleSkillDirs(): string[] {
    if (!fs.existsSync(SKILLER_SKILLS)) return [];
    return fs.readdirSync(SKILLER_SKILLS, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();
}

describe('.skiller/skills example skills', () => {
    const source = createMockSkillSource();
    const dirs = exampleSkillDirs();

    it('includes the change-map boundary-mapping example', () => {
        expect(dirs).toContain('change-map');
    });

    for (const name of dirs) {
        describe(name, () => {
            const dir = path.join(SKILLER_SKILLS, name);
            const yaml = fs.readFileSync(path.join(dir, 'skill.yaml'), 'utf8');

            it('parses successfully against the schema', () => {
                const result = parseSkillFromContent(yaml, dir, source);
                if (!result.success) {
                    throw new Error(`Parse failed for ${name}:\n${result.error.error}`);
                }
                expect(result.success).toBe(true);
            });

            it('every referenced step file exists on disk', () => {
                const result = parseSkillFromContent(yaml, dir, source);
                if (!result.success) return; // parse failure already reported above
                const missing = result.skill.steps
                    .filter(step => step.file && !fs.existsSync(path.join(dir, step.file)))
                    .map(step => step.file);
                expect(missing).toEqual([]);
            });
        });
    }
});
