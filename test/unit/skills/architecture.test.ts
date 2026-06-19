/**
 * Architecture guard for the Step Inspection feature.
 *
 * The feature is extensible because its dependency direction is one-way: the
 * data/store layer (execution-state + the step-inspection helpers) is the hub,
 * and the presentation layer (graph webview, panel-manager, doc provider) depends
 * on IT — never the reverse. That inversion is what lets new consumers (extra
 * panels, exports, a tree view, …) be added by EXTENSION without revisiting
 * capture or storage.
 *
 * This test pins that invariant: if someone introduces a back-edge (the data
 * layer importing the graph/presentation layer), it fails loudly.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/** True if an import specifier points into the graph/presentation layer. */
function isPresentationImport(spec: string): boolean {
    return /(^|\/)graph(\/|$)/.test(spec);
}

/** Every `from '...'` / `export ... from '...'` specifier in a source file. */
function importSpecifiers(absFile: string): string[] {
    const text = fs.readFileSync(absFile, 'utf8');
    const specs: string[] = [];
    const re = /\bfrom\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        specs.push(m[1]);
    }
    return specs;
}

const SKILLS = path.resolve(process.cwd(), 'src/skills');

describe('step-inspection architecture guard', () => {
    describe('the presentation-import detector has teeth', () => {
        it('flags graph/presentation specifiers', () => {
            expect(isPresentationImport('./graph/panel-manager')).toBe(true);
            expect(isPresentationImport('../graph/step-inspection-provider')).toBe(true);
            expect(isPresentationImport('./graph')).toBe(true);
        });

        it('allows data/util specifiers', () => {
            expect(isPresentationImport('./types')).toBe(false);
            expect(isPresentationImport('./utils')).toBe(false);
            expect(isPresentationImport('./execution-state')).toBe(false);
            expect(isPresentationImport('vscode')).toBe(false);
            expect(isPresentationImport('./paragraph-helper')).toBe(false);
        });
    });

    // The data/store layer of the inspection feature. These must stay free of any
    // dependency on the graph/presentation layer so new surfaces can read from
    // them without the store ever needing to change. Add new data-layer modules
    // to this list as the feature grows.
    const dataLayer = ['execution-state.ts', 'step-inspection.ts'];

    for (const rel of dataLayer) {
        it(`${rel} does not import the presentation (graph) layer`, () => {
            const offending = importSpecifiers(path.join(SKILLS, rel)).filter(isPresentationImport);
            expect(offending).toEqual([]);
        });
    }
});
