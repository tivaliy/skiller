/**
 * Approval wording for Skiller's own tools: one source shared by the tools'
 * prepareInvocation (chat/agent confirmations) and the native run's approval card.
 */

import { describe, it, expect } from 'vitest';
import {
    describeSkillerToolCall,
    createFileApproval,
    replaceInFileApproval,
    writeSkillApproval,
} from '../../../src/tools/approval-text';
import { CreateFileTool } from '../../../src/tools/create-file';
import { ReplaceInFileTool } from '../../../src/tools/replace-in-file';

const token = { isCancellationRequested: false } as never;

describe('Skiller tool approval wording', () => {
    it('create file: the existing title and message with a content preview', () => {
        expect(createFileApproval({ filePath: 'notes/a.md', content: 'hello' })).toEqual({
            title: 'Create File',
            markdown: 'Create file at **notes/a.md**?\n\nContent preview:\n```\nhello\n```',
        });
        expect(createFileApproval({ filePath: 'a', content: '' }).markdown).toContain('```\n(empty)\n```');
        const long = 'x'.repeat(150);
        expect(createFileApproval({ filePath: 'a', content: long }).markdown).toContain(`\`\`\`\n${'x'.repeat(100)}...\n\`\`\``);
    });

    it('replace in file: the existing title and message with a search preview', () => {
        expect(replaceInFileApproval({ filePath: 'src/a.ts', search: 'foo' })).toEqual({
            title: 'Replace in File',
            markdown: 'Replace text in **src/a.ts**?\n\nSearch: `foo`',
        });
        const long = 'y'.repeat(80);
        expect(replaceInFileApproval({ filePath: 'a', search: long }).markdown).toBe(`Replace text in **a**?\n\nSearch: \`${'y'.repeat(60)}...\``);
    });

    it('write skill: names the skill and its files', () => {
        expect(writeSkillApproval({ id: 'my-skill', files: [{ path: 'skill.yaml' }, { path: 'steps/a.md' }] })).toEqual({
            title: 'Write Skiller skill',
            markdown: 'Write skill **my-skill** with files: `skill.yaml`, `steps/a.md`?',
        });
    });

    it('model-supplied text cannot break out of the Markdown it is shown in', () => {
        // A preview containing a fence gets a longer fence, so it cannot close the block early.
        expect(createFileApproval({ filePath: 'a', content: 'x\n```\n# not a heading' }).markdown)
            .toBe('Create file at **a**?\n\nContent preview:\n````\nx\n```\n# not a heading\n````');
        // Paths and ids are escaped inside the bold, and kept on one line.
        expect(createFileApproval({ filePath: '**x**[y](z)<b>_`\n# h', content: 'c' }).markdown.split('\n')[0])
            .toBe(String.raw`Create file at **\*\*x\*\*\[y\](z)\<b\>\_\` # h**?`);
        expect(replaceInFileApproval({ filePath: 'a*b', search: 's' }).markdown).toBe('Replace text in **a\\*b**?\n\nSearch: `s`');
        expect(writeSkillApproval({ id: 'x**y', files: [] }).markdown).toBe('Write skill **x\\*\\*y** with files: ?');
        // Code spans use a backtick run longer than any inside, padded when the text touches a backtick.
        expect(replaceInFileApproval({ filePath: 'a', search: 'a`b' }).markdown).toBe('Replace text in **a**?\n\nSearch: ``a`b``');
        expect(replaceInFileApproval({ filePath: 'a', search: '`x`' }).markdown).toBe('Replace text in **a**?\n\nSearch: `` `x` ``');
        expect(writeSkillApproval({ id: 's', files: [{ path: 'a``b.md' }] }).markdown).toBe('Write skill **s** with files: ```a``b.md```?');
    });

    it('describeSkillerToolCall dispatches by tool name and ignores other or malformed calls', () => {
        expect(describeSkillerToolCall('skiller_createFile', { filePath: 'a.md', content: 'c' })?.title).toBe('Create File');
        expect(describeSkillerToolCall('skiller_replaceInFile', { filePath: 'a.md', search: 's', replace: 'r' })?.title).toBe('Replace in File');
        expect(describeSkillerToolCall('skiller_writeSkill', { id: 'x', files: [] })?.title).toBe('Write Skiller skill');
        expect(describeSkillerToolCall('mcp_fetch', { url: 'x' })).toBeUndefined();
        expect(describeSkillerToolCall('skiller_createFile', 'not an object')).toBeUndefined();
        expect(describeSkillerToolCall('skiller_createFile', { content: 'no path' })).toBeUndefined();
        expect(describeSkillerToolCall('skiller_writeSkill', { id: 'x' })).toBeUndefined();
    });

    it('the tools confirm with the same wording', async () => {
        const created = await new CreateFileTool().prepareInvocation({ input: { filePath: 'a.md', content: 'hi' } } as never, token);
        expect(created.confirmationMessages?.title).toBe('Create File');
        expect((created.confirmationMessages?.message as { value: string }).value)
            .toBe(createFileApproval({ filePath: 'a.md', content: 'hi' }).markdown);
        expect(created.invocationMessage).toBe('Creating file: a.md');

        const replaced = await new ReplaceInFileTool().prepareInvocation({ input: { filePath: 'b.ts', search: 's', replace: 'r' } } as never, token);
        expect(replaced.confirmationMessages?.title).toBe('Replace in File');
        expect((replaced.confirmationMessages?.message as { value: string }).value)
            .toBe('Replace text in **b.ts**?\n\nSearch: `s`');
        expect(replaced.invocationMessage).toBe('Replacing text in: b.ts');
    });
});
