/**
 * Full scaffold gate (parse + validate with step files + readiness) over every
 * skill Skiller ships, and over the "Complete example" in the skill-creator's
 * authoring reference — so neither can drift from the schema the writer enforces.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateStagedSkill } from '../../../src/scaffold/validate-staged';
import { normalizeFiles } from '../../../src/scaffold/ids';
import { createNodeScaffoldFs } from '../../helpers/node-scaffold-fs';
import { useDiskBackedVscodeFs } from '../../helpers/disk-vscode-fs';

const REPO = process.cwd();

/** Skiller's own language-model tools — the only tools guaranteed to be installed. */
const SKILLER_TOOLS = ['skiller_createFile', 'skiller_replaceInFile', 'skiller_writeSkill'].map((name) => ({
    name,
    description: name,
    inputSchema: {},
    tags: [],
}));

/** Every shipped skill folder: the examples (copied by id = folder name) and the built-ins. */
const SHIPPED = ['.skiller/skills', 'skills'].flatMap((root) =>
    fs.readdirSync(path.join(REPO, root), { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => `${root}/${e.name}`),
);

/** Pull the fenced block that follows a "`<file>`:" label in the build step's raw reference. */
function exampleBlock(markdown: string, file: string, lang: string): string {
    const raw = /\{% raw %\}([\s\S]*?)\{% endraw %\}/.exec(markdown)?.[1];
    if (!raw) {
        throw new Error('02-build.md has no {% raw %} authoring reference');
    }
    const label = `\`${file}\`:`;
    const at = raw.indexOf(label);
    if (at < 0) {
        throw new Error(`Complete example has no ${label} block`);
    }
    const block = new RegExp('```' + lang + '\\n([\\s\\S]*?)\\n```\\n').exec(raw.slice(at));
    if (!block) {
        throw new Error(`Complete example's ${label} block is not a \`\`\`${lang} fence`);
    }
    return `${block[1]}\n`;
}

describe('shipped skills pass the full scaffold gate', () => {
    beforeEach(() => {
        useDiskBackedVscodeFs();
        (vscode.lm as unknown as { tools: unknown[] }).tools = SKILLER_TOOLS;
    });
    afterEach(() => {
        (vscode.lm as unknown as { tools: unknown[] }).tools = [];
    });

    it('finds the shipped skills', () => {
        expect(SHIPPED).toEqual(expect.arrayContaining(['.skiller/skills/change-map', 'skills/skill-creator']));
    });

    // Examples are offered for copying under their folder name; a different `id:` in
    // skill.yaml would make every copy fail the folder/id check.
    it.each(SHIPPED)('%s declares the id of its folder', (rel) => {
        const yaml = fs.readFileSync(path.join(REPO, rel, 'skill.yaml'), 'utf8');
        expect(/^id:\s*["']?([^"'\s#]+)/m.exec(yaml)?.[1]).toBe(path.basename(rel));
    });

    // Path safety (incl. Windows names) applies to copies too; pin it on every shipped source.
    const TEMPLATES = fs.readdirSync(path.join(REPO, 'templates')).map((t) => `templates/${t}`);
    it.each([...SHIPPED, ...TEMPLATES])('%s has only copy-safe file paths', async (rel) => {
        const files = await createNodeScaffoldFs().readTree(path.join(REPO, rel));
        expect(normalizeFiles(files, { trusted: true }).errors).toEqual([]);
    });

    it.each(SHIPPED)('%s', async (rel) => {
        const tier = rel.startsWith('skills/') ? 'builtin' : 'workspace';
        expect(await validateStagedSkill(path.join(REPO, rel), { tier })).toEqual([]);
    });

    describe("skill-creator's Complete example", () => {
        let tmp: string;
        beforeEach(() => {
            tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-example-'));
        });
        afterEach(() => {
            fs.rmSync(tmp, { recursive: true, force: true });
        });

        it('is a valid, ready skill', async () => {
            const md = fs.readFileSync(path.join(REPO, 'skills/skill-creator/steps/02-build.md'), 'utf8');
            const yaml = exampleBlock(md, 'skill.yaml', 'yaml');
            const step = exampleBlock(md, 'steps/01-draft.md', 'markdown');
            const id = /^id:\s*(\S+)/m.exec(yaml)?.[1];
            expect(id).toBe('release-note');

            const dir = path.join(tmp, id!);
            fs.mkdirSync(path.join(dir, 'steps'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'skill.yaml'), yaml);
            fs.writeFileSync(path.join(dir, 'steps/01-draft.md'), step);

            expect(await validateStagedSkill(dir)).toEqual([]);
        });
    });
});
