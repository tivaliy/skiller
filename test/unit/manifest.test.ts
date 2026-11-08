/**
 * Manifest declarations that change how VS Code treats the extension.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));

describe('package.json', () => {
    it('says why Skiller is off in Restricted Mode instead of silently missing', () => {
        // Skills run tools and write files, so untrusted folders stay unsupported; the
        // description is what VS Code shows in its Restricted Mode extension list.
        const untrusted = pkg.capabilities?.untrustedWorkspaces;
        expect(untrusted?.supported).toBe(false);
        expect(untrusted?.description).toMatch(/trust/i);
    });
});
