/**
 * The Copilot agent plugin: package.json contributes it, plugin.json carries the
 * agent-plugins schema and the extension version, and the /skiller skill is named
 * after the tools it teaches the agent to use.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('chat plugin', () => {
    const entry = pkg.contributes?.chatPlugins?.[0];
    const dir = path.join(root, entry?.path ?? 'missing');

    it('is contributed from a folder', () => {
        expect(pkg.contributes.chatPlugins).toEqual([{ path: './chat-plugin/' }]);
        expect(fs.statSync(dir).isDirectory()).toBe(true);
    });

    it('plugin.json has the agent-plugins schema and the extension version', () => {
        const plugin = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
        expect(plugin.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
        expect(plugin.name).toBe('skiller');
        expect(plugin.version).toBe(pkg.version);
        expect(plugin.description).toBeTruthy();
    });

    it('skills/skiller/SKILL.md is named skiller and teaches the real tools', () => {
        const md = fs.readFileSync(path.join(dir, 'skills/skiller/SKILL.md'), 'utf8');
        const front = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? '';
        expect(front).toMatch(/^name: skiller$/m);
        expect(front).toMatch(/^description: .+/m);
        const toolNames = pkg.contributes.languageModelTools.map((t: { name: string }) => t.name);
        for (const tool of ['skiller_listSkills', 'skiller_runSkill']) {
            expect(toolNames).toContain(tool);
            expect(md).toContain(tool);
        }
        expect(md).toContain('/skills');
    });
});
