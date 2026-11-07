/**
 * Approval wording for Skiller's own tools.
 *
 * One source for the text that asks the user to allow a Skiller tool call: the
 * tools' `prepareInvocation` confirmations (chat and agent runs) and the native
 * runner's approval card both use it. Plain Markdown, no vscode types.
 *
 * Paths, ids, and previews come from the model, so they are escaped or fenced:
 * nothing in them can render as Markdown or break out of its block.
 *
 * @module tools/approval-text
 */

import { codeSpan, escapeMarkdown, fencedBlock } from '../skills/utils';

export interface ToolApprovalText {
    title: string;
    /** Markdown body. */
    markdown: string;
}

export function createFileApproval(input: { filePath: string; content?: string }): ToolApprovalText {
    const { filePath, content } = input;
    const contentPreview = content && content.length > 100
        ? `${content.substring(0, 100)}...`
        : content || '(empty)';
    return {
        title: 'Create File',
        markdown: `Create file at **${escapeMarkdown(filePath)}**?\n\n` +
            `Content preview:\n${fencedBlock(contentPreview)}`
    };
}

export function replaceInFileApproval(input: { filePath: string; search?: string }): ToolApprovalText {
    const { filePath, search } = input;
    const searchPreview = search && search.length > 60
        ? `${search.substring(0, 60)}...`
        : search || '(empty)';
    return {
        title: 'Replace in File',
        markdown: `Replace text in **${escapeMarkdown(filePath)}**?\n\n` +
            `Search: ${codeSpan(searchPreview)}`
    };
}

/** The approval wording for skiller_writeSkill, used by the tool's confirmation and the runner's card. */
export function writeSkillApproval(input: { id: string; files: Array<{ path: string }> }): ToolApprovalText {
    const files = input.files.map(f => codeSpan(f.path)).join(', ');
    return {
        title: 'Write Skiller skill',
        markdown: `Write skill **${escapeMarkdown(input.id)}** with files: ${files}?`
    };
}

/** The approval wording for a Skiller tool call, or undefined for other tools or malformed input. */
export function describeSkillerToolCall(toolName: string, input: unknown): ToolApprovalText | undefined {
    if (typeof input !== 'object' || input === null) return undefined;
    const fields = input as Record<string, unknown>;

    switch (toolName) {
        case 'skiller_createFile':
            if (typeof fields.filePath !== 'string') return undefined;
            return createFileApproval({ filePath: fields.filePath, content: optionalString(fields.content) });
        case 'skiller_replaceInFile':
            if (typeof fields.filePath !== 'string') return undefined;
            return replaceInFileApproval({ filePath: fields.filePath, search: optionalString(fields.search) });
        case 'skiller_writeSkill': {
            const { id, files } = fields;
            if (typeof id !== 'string' || !Array.isArray(files)) return undefined;
            const paths = files.map(f => ({ path: String((f as { path?: unknown } | null)?.path ?? '') }));
            return writeSkillApproval({ id, files: paths });
        }
        default:
            return undefined;
    }
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}
