/**
 * skiller_replaceInFile Tool
 *
 * Replaces text within an existing file using VS Code's native filesystem API.
 *
 * ## Why This Tool Exists
 *
 * Skills that build documents incrementally across multiple steps need targeted
 * in-place replacement — not full overwrites. Each step replaces its own
 * [[PLACEHOLDER]] section without touching the rest of the file.
 *
 * Full overwrites via skiller_createFile are problematic for multi-step document
 * generation because the LLM must re-send the entire file content on each step,
 * wasting tokens and risking accidental modification of other sections.
 *
 * @module tools/replace-in-file
 */

import * as vscode from 'vscode';
import { resolvePath } from './utils';

/**
 * Input parameters for the replace-in-file tool.
 */
interface ReplaceInFileInput {
    /** The path to the file to modify (absolute or relative to workspace) */
    filePath: string;
    /** The exact text to search for in the file */
    search: string;
    /** The text to replace the search string with */
    replace: string;
}

/**
 * Language Model Tool for replacing text within an existing file.
 *
 * Reads the file, replaces all occurrences of the search string with the
 * replacement, and writes the result back. Returns an error if the file
 * doesn't exist or if the search string is not found.
 */
export class ReplaceInFileTool implements vscode.LanguageModelTool<ReplaceInFileInput> {
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ReplaceInFileInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { filePath, search, replace } = options.input;

        if (!filePath) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('Error: filePath is required')
            ]);
        }

        if (search === undefined || search === null) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('Error: search is required')
            ]);
        }

        if (token.isCancellationRequested) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('Error: Operation cancelled')
            ]);
        }

        try {
            const resolvedPath = resolvePath(filePath);
            const fileUri = vscode.Uri.file(resolvedPath);

            // Read current file content
            const bytes = await vscode.workspace.fs.readFile(fileUri);
            const content = new TextDecoder().decode(bytes);

            if (!content.includes(search)) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        `Error: search string not found in ${resolvedPath}`
                    )
                ]);
            }

            // Replace all occurrences and write back
            const updated = content.split(search).join(replace);
            await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(updated));

            const count = content.split(search).length - 1;
            console.log(`[skiller_replaceInFile] Replaced ${count} occurrence(s) in: ${resolvedPath}`);

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Replaced ${count} occurrence(s) of search string in ${resolvedPath}`
                )
            ]);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[skiller_replaceInFile] Failed: ${errorMessage}`);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Error replacing in file: ${errorMessage}`)
            ]);
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ReplaceInFileInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { filePath, search } = options.input;
        const searchPreview = search && search.length > 60
            ? `${search.substring(0, 60)}...`
            : search || '(empty)';

        return {
            invocationMessage: `Replacing text in: ${filePath}`,
            confirmationMessages: {
                title: 'Replace in File',
                message: new vscode.MarkdownString(
                    `Replace text in **${filePath}**?\n\n` +
                    `Search: \`${searchPreview}\``
                )
            }
        };
    }
}
