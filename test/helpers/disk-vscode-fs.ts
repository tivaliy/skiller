/**
 * Point the vscode mock's `workspace.fs.readFile` / `readDirectory` / `stat` at the real disk.
 * Call `useDiskBackedVscodeFs()` in `beforeEach` (the config has `restoreMocks`,
 * so the stubs must be re-applied for every test).
 */
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { vi } from 'vitest';

export function useDiskBackedVscodeFs(): void {
    vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri) => {
        return new Uint8Array(await fs.promises.readFile(uri.fsPath));
    });
    vi.mocked(vscode.workspace.fs.readDirectory).mockImplementation(async (uri) => {
        const entries = await fs.promises.readdir(uri.fsPath, { withFileTypes: true });
        return Promise.all(entries.map(async (e): Promise<[string, vscode.FileType]> => {
            if (!e.isSymbolicLink()) {
                return [e.name, e.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File];
            }
            // Like VS Code: the link bit plus the type of what it points at.
            const target = await fs.promises.stat(`${uri.fsPath}/${e.name}`);
            return [e.name, vscode.FileType.SymbolicLink | (target.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File)];
        }));
    });
    vi.mocked(vscode.workspace.fs.stat).mockImplementation(async (uri) => {
        try {
            const s = await fs.promises.stat(uri.fsPath);
            return {
                type: s.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
                ctime: s.ctimeMs,
                mtime: s.mtimeMs,
                size: s.size,
            };
        } catch {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    });
}
