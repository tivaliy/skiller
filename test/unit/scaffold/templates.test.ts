import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEMPLATES, renderTemplate } from '../../../src/scaffold/sources/templates';
import type { SkillFiles } from '../../../src/scaffold/types';
import { parseSkillFromContent } from '../../../src/skills/parser';
import { checkReadiness } from '../../../src/skills/readiness';
import { validateSkill } from '../../../src/skills/validators/factory';
import { useDiskBackedVscodeFs } from '../../helpers/disk-vscode-fs';

const TEMPLATES_ROOT = path.resolve(__dirname, '../../../templates');

function readTreeFromDisk(dir: string, base = dir, out = new Map<string, string>()): SkillFiles {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            readTreeFromDisk(full, base, out);
        } else {
            out.set(path.relative(base, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8'));
        }
    }
    return out;
}

describe('templates', () => {
    let tmp: string;
    beforeEach(() => {
        useDiskBackedVscodeFs();
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skiller-tpl-'));
        (vscode.lm as unknown as { tools: unknown[] }).tools = [
            { name: 'skiller_createFile', description: 'create', inputSchema: {} },
        ];
    });
    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
        (vscode.lm as unknown as { tools: unknown[] }).tools = [];
    });

    it('lists the five templates', () => {
        expect(TEMPLATES.map((t) => t.id)).toEqual(['basic', 'approval', 'loop', 'tool', 'editor']);
    });

    describe.each(TEMPLATES.map((t) => t.id))('%s', (id) => {
        const dir = path.join(TEMPLATES_ROOT, id);

        it('has a folder with skill.yaml', () => {
            expect(fs.existsSync(path.join(dir, 'skill.yaml'))).toBe(true);
        });

        it('renders with no leftover placeholder', () => {
            const rendered = renderTemplate(readTreeFromDisk(dir), { id: 'my-skill', name: 'My Skill' });
            for (const content of rendered.values()) {
                expect(content).not.toContain('__SKILL_');
            }
        });

        it('parses, validates (with step files) and is ready to run', async () => {
            const rendered = renderTemplate(readTreeFromDisk(dir), { id: 'my-skill', name: 'My Skill' });
            const skillDir = path.join(tmp, 'my-skill');
            for (const [p, content] of rendered) {
                fs.mkdirSync(path.dirname(path.join(skillDir, p)), { recursive: true });
                fs.writeFileSync(path.join(skillDir, p), content);
            }
            const parsed = parseSkillFromContent(rendered.get('skill.yaml')!, skillDir, {
                type: 'workspace',
                path: skillDir,
            });
            expect(parsed.success, JSON.stringify(parsed)).toBe(true);
            if (!parsed.success) {
                return;
            }
            expect(parsed.skill.id).toBe('my-skill');
            expect(parsed.skill.name).toBe('My Skill');

            const result = await validateSkill(parsed.skill, { validateStepFiles: true });
            expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
            expect(result.valid).toBe(true);

            const ready = checkReadiness(parsed.skill, {});
            expect(ready.errors).toEqual([]);
        });
    });
});
