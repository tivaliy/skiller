import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVsCodeScaffoldFs } from '../../../src/scaffold/fs';
import { useDiskBackedVscodeFs } from '../../helpers/disk-vscode-fs';

describe('createVsCodeScaffoldFs().readTree', () => {
    let dir: string;
    beforeEach(() => {
        useDiskBackedVscodeFs();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-fs-'));
        fs.mkdirSync(path.join(dir, 'steps'));
        fs.writeFileSync(path.join(dir, 'skill.yaml'), 'id: x\n');
        fs.writeFileSync(path.join(dir, 'steps/01.md'), 'hi ✨\n');
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('reads nested text files, skipping dot entries', async () => {
        fs.writeFileSync(path.join(dir, '.hidden'), 'x');
        const files = await createVsCodeScaffoldFs().readTree(dir);
        expect([...files.entries()]).toEqual([['skill.yaml', 'id: x\n'], ['steps/01.md', 'hi ✨\n']]);
    });

    it('refuses a file that is not UTF-8 text instead of corrupting it', async () => {
        fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00]));
        await expect(createVsCodeScaffoldFs().readTree(dir)).rejects.toThrow(
            '"logo.png" is not UTF-8 text; only text files can be copied.',
        );
    });

    it('does not follow a symlinked folder (no infinite loop)', async () => {
        fs.symlinkSync(dir, path.join(dir, 'steps', 'loop'));
        await expect(createVsCodeScaffoldFs().readTree(dir)).rejects.toThrow(
            '"steps/loop" is a symbolic link; symlinked folders cannot be copied.',
        );
    });
});
