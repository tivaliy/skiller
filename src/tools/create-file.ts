/**
 * skiller_createFile Tool
 *
 * Creates a file using VS Code's native filesystem API.
 *
 * ## Why This Tool Exists
 *
 * Built-in Copilot tools like `copilot_createFile` have internal context requirements
 * that make them unusable from third-party chat participants. Specifically:
 *
 * - `copilot_createFile` checks for `this._promptContext?.stream` before execution
 * - This internal property is only set within Copilot's native chat orchestration
 * - When invoked via `vscode.lm.invokeTool()` from a third-party participant,
 *   even with proper `toolInvocationToken`, the internal context is not passed
 * - This results in "Invalid stream" error
 *
 * ## Technical Details (from Copilot Chat extension analysis)
 *
 * Location: github.copilot-chat extension, dist/extension.js
 * The check: `if(!this._promptContext?.stream) throw new Error("Invalid stream")`
 *
 * The stream is used by Copilot to progressively write file content as the LLM
 * generates it. Since third-party participants don't have access to this internal
 * streaming mechanism, the tool fails.
 *
 * Interestingly, `copilot_createDirectory` works because it doesn't require
 * streaming - it's a simple atomic operation.
 *
 * ## Error Handling Pattern
 *
 * This tool follows the official VS Code Language Model Tools pattern:
 * - **Success**: Returns `LanguageModelToolResult` with success message
 * - **Error**: Returns `LanguageModelToolResult` with error message (not thrown)
 *
 * This matches the pattern from official VS Code extension samples (RunInTerminalTool)
 * where errors are caught and returned as text results, allowing the LLM to see
 * and respond to error messages appropriately.
 *
 * @see https://github.com/microsoft/vscode-extension-samples/blob/main/chat-sample/src/tools.ts
 *
 * ## References
 *
 * - GitHub Discussion #156285: Programmatically invoking copilot tools
 *   https://github.com/orgs/community/discussions/156285
 * - Issue #12568: Custom agent chatmode doesn't have edit permission
 *   https://github.com/microsoft/vscode-copilot-release/issues/12568
 * - Issue #12647: Certain tools not available in custom chat modes
 *   https://github.com/microsoft/vscode-copilot-release/issues/12647
 *
 * @module tools/create-file
 */

import * as vscode from 'vscode';
import { resolvePath } from './utils';

/**
 * Input parameters for the create-file tool.
 */
interface CreateFileInput {
    /** The path where the file should be created (absolute or relative to workspace) */
    filePath: string;
    /** The content to write to the file */
    content: string;
}

/**
 * Language Model Tool for creating files.
 *
 * This tool provides reliable file creation that works in all VS Code contexts,
 * including third-party chat participants where built-in Copilot tools fail.
 *
 * Error handling follows the official VS Code extension samples pattern:
 * errors are caught and returned as LanguageModelToolResult text parts.
 */
export class CreateFileTool implements vscode.LanguageModelTool<CreateFileInput> {
    /**
     * Invoke the tool to create a file.
     *
     * @param options - Tool invocation options containing input parameters
     * @param token - Cancellation token
     * @returns Tool result with success or error message
     */
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<CreateFileInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { filePath, content } = options.input;

        // Validate required input
        if (!filePath) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('Error: filePath is required')
            ]);
        }

        // Check for cancellation
        if (token.isCancellationRequested) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('Error: Operation cancelled')
            ]);
        }

        try {
            // Resolve the file path (handles both absolute and relative)
            const resolvedPath = resolvePath(filePath);
            const fileUri = vscode.Uri.file(resolvedPath);

            // Write the file
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(fileUri, encoder.encode(content || ''));

            console.log(`[skiller_createFile] Created file: ${resolvedPath}`);

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Created file at ${resolvedPath}`)
            ]);
        } catch (error) {
            // Return error as result (matches official VS Code sample pattern)
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[skiller_createFile] Failed to create file: ${errorMessage}`);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Error creating file: ${errorMessage}`)
            ]);
        }
    }

    /**
     * Prepare the tool invocation with confirmation messages.
     */
    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<CreateFileInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { filePath, content } = options.input;
        const contentPreview = content && content.length > 100
            ? `${content.substring(0, 100)}...`
            : content || '(empty)';

        return {
            invocationMessage: `Creating file: ${filePath}`,
            confirmationMessages: {
                title: 'Create File',
                message: new vscode.MarkdownString(
                    `Create file at **${filePath}**?\n\n` +
                    `Content preview:\n\`\`\`\n${contentPreview}\n\`\`\``
                )
            }
        };
    }
}
