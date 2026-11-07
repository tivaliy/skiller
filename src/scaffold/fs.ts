/** Boundary: ScaffoldFs on vscode.workspace.fs (remote/virtual FS compatible). */
import * as vscode from 'vscode';
import type { ScaffoldFs, SkillFiles } from './types';

const uri = (p: string) => vscode.Uri.file(p);

async function exists(p: string): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri(p));
        return true;
    } catch {
        return false;
    }
}

/**
 * Read a skill folder as text files keyed by relative path. Refuses (throws) rather
 * than producing a broken copy: a symlinked folder could loop forever, and a file that
 * is not UTF-8 text would be corrupted by the text round-trip.
 */
async function readTree(dir: string, prefix = '', out = new Map<string, string>()): Promise<SkillFiles> {
    for (const [name, type] of await vscode.workspace.fs.readDirectory(uri(dir))) {
        if (name.startsWith('.')) {
            continue;
        }
        const full = `${dir}/${name}`;
        const rel = prefix ? `${prefix}/${name}` : name;
        if (type & vscode.FileType.Directory) {
            if (type & vscode.FileType.SymbolicLink) {
                throw new Error(`"${rel}" is a symbolic link; symlinked folders cannot be copied.`);
            }
            await readTree(full, rel, out);
        } else {
            const bytes = await vscode.workspace.fs.readFile(uri(full));
            try {
                out.set(rel, new TextDecoder('utf-8', { fatal: true }).decode(bytes));
            } catch {
                throw new Error(`"${rel}" is not UTF-8 text; only text files can be copied.`);
            }
        }
    }
    return out;
}

export function createVsCodeScaffoldFs(): ScaffoldFs {
    return {
        exists,
        mkdirp: (p) => Promise.resolve(vscode.workspace.fs.createDirectory(uri(p))),
        writeFile: (p, content) =>
            Promise.resolve(vscode.workspace.fs.writeFile(uri(p), new TextEncoder().encode(content))),
        readTree: (dir) => readTree(dir),
        rename: (from, to) => Promise.resolve(vscode.workspace.fs.rename(uri(from), uri(to), { overwrite: false })),
        rm: async (p) => {
            if (!(await exists(p))) {
                return;
            }
            await vscode.workspace.fs.delete(uri(p), { recursive: true, useTrash: false });
        },
    };
}
