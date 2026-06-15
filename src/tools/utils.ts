/**
 * Skiller Tools - Shared Utilities
 *
 * Common utilities for custom VS Code Language Model tools.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getSetting } from '../settings';

/**
 * Resolve a file path, handling both absolute and relative paths.
 *
 * By default, writes are confined to the workspace folder: a path that resolves
 * outside the workspace (via `..`, an absolute path elsewhere, or a different
 * drive) is rejected. Set `skiller.skills.allowOutsideWorkspaceWrites` to `true`
 * to opt out. This guards against shared/forked skills targeting arbitrary paths
 * (e.g. `~/.ssh/...`) through the file tools.
 *
 * @param inputPath - The path to resolve (absolute or relative)
 * @returns The resolved absolute path
 * @throws If the path escapes the workspace and out-of-workspace writes are disabled
 */
export function resolvePath(inputPath: string): string {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const resolved = path.isAbsolute(inputPath)
        ? path.normalize(inputPath)
        : root
            ? path.resolve(root, inputPath)
            : path.normalize(inputPath);

    if (getSetting('skills.allowOutsideWorkspaceWrites')) {
        return resolved;
    }

    if (!root) {
        throw new Error(
            'No workspace folder is open, so the target path cannot be confined to a workspace. ' +
            'Open a folder, or enable "skiller.skills.allowOutsideWorkspaceWrites" to allow writes anywhere.'
        );
    }

    const relative = path.relative(root, resolved);
    const escapesWorkspace =
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative);

    if (escapesWorkspace) {
        throw new Error(
            `Refusing to write outside the workspace: "${inputPath}" resolves to "${resolved}". ` +
            'Enable "skiller.skills.allowOutsideWorkspaceWrites" to override.'
        );
    }

    return resolved;
}
