/**
 * Skiller Tools Module
 *
 * Custom VS Code Language Model tools that provide reliable functionality
 * for skill workflows. These tools are designed to work in all VS Code contexts,
 * including third-party chat participants where built-in Copilot tools may fail.
 *
 * ## Why Custom Tools?
 *
 * Built-in Copilot tools have internal context requirements that make them
 * unusable from third-party chat participants:
 *
 * - `copilot_createFile` requires `_promptContext.stream` (throws "Invalid stream")
 * - `copilot_editFiles` requires internal conversation context
 * - These internal properties are NOT passed via `toolInvocationToken`
 *
 * ## Available Tools
 *
 * | Tool Name           | Description                    | Copilot Equivalent       |
 * |---------------------|--------------------------------|--------------------------|
 * | `skiller_createFile`     | Create a file with content     | `copilot_createFile`     |
 *
 * Note: `copilot_createDirectory` works fine from third-party participants
 * (no streaming required), so we don't need a custom replacement for it.
 *
 * ## Adding New Tools
 *
 * 1. Create a new file in `src/tools/` (e.g., `my-tool.ts`)
 * 2. Implement `vscode.LanguageModelTool<T>` interface
 * 3. Add input type to `types.ts`
 * 4. Register in `registerTools()` below
 * 5. Add to `package.json` `languageModelTools` contribution
 *
 * ## References
 *
 * - VS Code Language Model Tools API:
 *   https://code.visualstudio.com/api/extension-guides/ai/tools
 * - GitHub Discussion on Copilot tool limitations:
 *   https://github.com/orgs/community/discussions/156285
 *
 * @module tools
 */

import * as vscode from 'vscode';
import { CreateFileTool } from './create-file';
import { ReplaceInFileTool } from './replace-in-file';

// Re-export utilities for potential external use
export { resolvePath } from './utils';

/**
 * Tool registration entry.
 */
interface ToolRegistration {
    name: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool: vscode.LanguageModelTool<any>;
}

/**
 * Tool registration configuration.
 * Add new tools here to register them with VS Code.
 */
const TOOLS: ToolRegistration[] = [
    { name: 'skiller_createFile', tool: new CreateFileTool() },
    { name: 'skiller_replaceInFile', tool: new ReplaceInFileTool() }
];

/**
 * Register all Skiller tools with VS Code.
 *
 * This function should be called during extension activation.
 * Tools are registered with VS Code's Language Model API and become
 * available for use in chat participants and skill workflows.
 *
 * @param context - VS Code extension context for subscription management
 */
export function registerTools(context: vscode.ExtensionContext): void {
    for (const { name, tool } of TOOLS) {
        context.subscriptions.push(
            vscode.lm.registerTool(name, tool)
        );
        console.log(`[Skiller Tools] Registered: ${name}`);
    }

    console.log(`[Skiller Tools] Registered ${TOOLS.length} custom tools`);
}
