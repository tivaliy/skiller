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

/** True if an import specifier points at the VS Code runtime module. */
function isVscodeImport(spec: string): boolean {
    return spec === 'vscode';
}

const SKILLS = path.resolve(process.cwd(), 'src/skills');
const CONTEXT = path.join(SKILLS, 'context');
const OUTPUT = path.join(SKILLS, 'output');
const EDITOR = path.resolve(process.cwd(), 'src/editor');

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

/**
 * The defining invariant of the editor-context module: within
 * `src/skills/context/`, ONLY `accessors.ts` may touch the VS Code runtime.
 * Every other file operates on the captured snapshot, so it stays unit-testable
 * without a VS Code host. If someone imports `vscode` into types/sources/
 * resolver/index, the snapshot stops being host-free and the unit suite would
 * silently start depending on the editor runtime — this test fails loudly first.
 */
describe('editor-context vscode-isolation guard', () => {
    it('the vscode-import detector has teeth', () => {
        expect(isVscodeImport('vscode')).toBe(true);
        expect(isVscodeImport('./types')).toBe(false);
        expect(isVscodeImport('./accessors')).toBe(false);
        expect(isVscodeImport('vscode-uri')).toBe(false);
    });

    // accessors.ts is the single sanctioned VS Code boundary; it is expected to
    // import `vscode` and is therefore excluded from the assertion below.
    it('accessors.ts is the boundary and does import vscode', () => {
        const specs = importSpecifiers(path.join(CONTEXT, 'accessors.ts'));
        expect(specs.some(isVscodeImport)).toBe(true);
    });

    // Every non-accessors file in the module. These must stay runtime-free so
    // the captured snapshot unit-tests without a VS Code host. Add new
    // snapshot-layer modules here as the module grows.
    const snapshotLayer = ['types.ts', 'sources.ts', 'resolver.ts', 'index.ts'];

    for (const rel of snapshotLayer) {
        it(`context/${rel} does not import the vscode runtime`, () => {
            const offending = importSpecifiers(path.join(CONTEXT, rel)).filter(isVscodeImport);
            expect(offending).toEqual([]);
        });
    }
});

/**
 * The editor-native integration layer (src/editor/) splits into a pure-logic core
 * and a thin VS Code glue layer. The pure helpers — launch, matching — operate only
 * on the captured snapshot and injected dependencies, so they must stay free of any
 * `vscode` import and unit-test without a VS Code host. The glue files
 * (run-skill-command, code-action-provider, index) are the sanctioned boundary and
 * are expected to touch the runtime, so they are NOT asserted here. If someone
 * reaches for `vscode` inside a pure helper, the core stops being host-free and its
 * unit tests would silently depend on the editor runtime — this test fails loudly first.
 *
 * `LaunchContextStore` is the launch→/skill hand-off; it was hoisted into src/skills/
 * (shared CommandContext session state, the same kind as PendingStateManager). It is
 * vscode-free by design and is guarded below alongside the editor pure helpers.
 */
describe('editor-layer vscode-isolation guard', () => {
    // The pure-logic core of the editor module. These must stay runtime-free so
    // they unit-test without a VS Code host. Add new pure-helper modules here as
    // the module grows; leave the glue files (run-skill-command, code-action-
    // provider, index) out — they are the sanctioned vscode boundary.
    const pureHelpers = ['launch.ts', 'matching.ts'];

    for (const rel of pureHelpers) {
        it(`editor/${rel} does not import the vscode runtime`, () => {
            const offending = importSpecifiers(path.join(EDITOR, rel)).filter(isVscodeImport);
            expect(offending).toEqual([]);
        });
    }

    it('skills/launch-context-store.ts (the hoisted hand-off) does not import the vscode runtime', () => {
        const offending = importSpecifiers(path.join(SKILLS, 'launch-context-store.ts')).filter(isVscodeImport);
        expect(offending).toEqual([]);
    });
});

/**
 * The output-sink module mirrors the same split: the pure core (types, sinks)
 * routes the rendered summary to an injected `OutputDeps`, so it stays free of
 * any `vscode` import and unit-tests without a host. `accessors.ts` is the
 * sanctioned VS Code boundary (and `deliver-skill-output.ts`/`index.ts` pull it
 * in for their live default), so those are NOT asserted here.
 */
describe('editor-output vscode-isolation guard', () => {
    it('accessors.ts is the boundary and does import vscode', () => {
        const specs = importSpecifiers(path.join(OUTPUT, 'accessors.ts'));
        expect(specs.some(isVscodeImport)).toBe(true);
    });

    // The pure routing core. Must stay runtime-free so it unit-tests without a
    // VS Code host. Add new pure modules here; leave accessors.ts (the boundary) out.
    const pureLayer = ['types.ts', 'sinks.ts'];

    for (const rel of pureLayer) {
        it(`output/${rel} does not import the vscode runtime`, () => {
            const offending = importSpecifiers(path.join(OUTPUT, rel)).filter(isVscodeImport);
            expect(offending).toEqual([]);
        });
    }
});
