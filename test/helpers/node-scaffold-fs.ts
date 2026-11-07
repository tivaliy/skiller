import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ScaffoldFs, SkillFiles } from '../../src/scaffold/types';

export function createNodeScaffoldFs(): ScaffoldFs {
    async function walk(dir: string, prefix: string, out: Map<string, string>): Promise<void> {
        for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
            if (e.name.startsWith('.')) {
                continue;
            }
            const rel = prefix ? `${prefix}/${e.name}` : e.name;
            if (e.isDirectory()) {
                await walk(path.join(dir, e.name), rel, out);
            } else {
                out.set(rel, await fs.promises.readFile(path.join(dir, e.name), 'utf8'));
            }
        }
    }
    return {
        exists: async (p) => fs.existsSync(p),
        mkdirp: async (p) => {
            await fs.promises.mkdir(p, { recursive: true });
        },
        writeFile: (p, content) => fs.promises.writeFile(p, content, 'utf8'),
        readTree: async (dir): Promise<SkillFiles> => {
            const out = new Map<string, string>();
            await walk(dir, '', out);
            return out;
        },
        rename: (from, to) => fs.promises.rename(from, to),
        rm: (p) => fs.promises.rm(p, { recursive: true, force: true }),
    };
}
