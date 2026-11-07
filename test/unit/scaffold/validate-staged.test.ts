import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateStagedSkill } from '../../../src/scaffold/validate-staged';
import { useDiskBackedVscodeFs } from '../../helpers/disk-vscode-fs';

describe('validateStagedSkill', () => {
    let dir: string;
    beforeEach(() => {
        useDiskBackedVscodeFs();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        (vscode.lm.tools as unknown[]).length = 0;
    });

    function write(yamlExtra: string, step: string): void {
        fs.mkdirSync(path.join(dir, 'steps'));
        fs.writeFileSync(
            path.join(dir, 'skill.yaml'),
            `id: ${path.basename(dir)}\nname: T\ndescription: d\nversion: "1.0.0"\nsteps:\n  - id: s1\n    type: llm\n    file: steps/01.md\n    output: out\n${yamlExtra}`,
        );
        fs.writeFileSync(path.join(dir, 'steps/01.md'), step);
    }

    it('accepts a valid minimal skill', async () => {
        write('', 'Say hi');
        expect(await validateStagedSkill(dir)).toEqual([]);
    });

    it('reports an unknown output reference', async () => {
        write('', 'Use {{ outputs.missing }}');
        const errors = await validateStagedSkill(dir);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('outputs.missing');
    });

    it('reports a missing tool by name', async () => {
        write('', 'Say hi');
        fs.writeFileSync(
            path.join(dir, 'skill.yaml'),
            fs.readFileSync(path.join(dir, 'skill.yaml'), 'utf8').replace('    output: out\n', '    output: out\n    tools: [nope_tool]\n'),
        );
        const errors = await validateStagedSkill(dir);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('nope_tool');
    });

    function addTools(list: string): void {
        const p = path.join(dir, 'skill.yaml');
        fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('    output: out\n', `    output: out\n    tools: [${list}]\n`));
    }

    it('rejects a staged skill that references skiller_writeSkill (built-in only)', async () => {
        (vscode.lm.tools as unknown[]).push({ name: 'skiller_writeSkill', description: 'w', inputSchema: {}, tags: [] });
        write('', 'Say hi');
        addTools('skiller_writeSkill');
        const errors = await validateStagedSkill(dir);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("can only be used by Skiller's built-in skills");
    });

    it('accepts skiller_writeSkill when validating as a built-in', async () => {
        (vscode.lm.tools as unknown[]).push({ name: 'skiller_writeSkill', description: 'w', inputSchema: {}, tags: [] });
        write('', 'Say hi');
        addTools('skiller_writeSkill');
        expect(await validateStagedSkill(dir, { tier: 'builtin' })).toEqual([]);
    });

    it('checkTools: false skips tool readiness (copies are for editing)', async () => {
        write('', 'Say hi');
        addTools('nope_tool');
        expect(await validateStagedSkill(dir, { checkTools: false })).toEqual([]);
    });

    it('checkTools: false still reports structural errors', async () => {
        write('', 'Use {{ outputs.missing }}');
        expect(await validateStagedSkill(dir, { checkTools: false })).toHaveLength(1);
    });
});
