/**
 * The Skiller status bar item — a permanent way in now that the `@skiller` chat
 * participant is gone. Idle, it opens Show Skills; during a run it names the
 * running skill and brings its graph (where the run's cards wait) forward.
 *
 * It has an id and a name, so people can hide it from the status bar's own
 * context menu; no setting is needed.
 */

import * as vscode from 'vscode';
import type { Skill } from '../skills/types';

/** What the item needs from the RunController. */
export interface StatusBarRuns {
    readonly active: { skill: Skill } | undefined;
    onDidChangeActive(listener: () => void): { dispose(): void };
}

export function createSkillerStatusBar(runs: StatusBarRuns): vscode.Disposable {
    const item = vscode.window.createStatusBarItem('skiller.status', vscode.StatusBarAlignment.Right, 100);
    item.name = 'Skiller';

    const render = (): void => {
        const running = runs.active?.skill;
        if (running) {
            item.text = `$(loading~spin) ${running.name}`;
            item.tooltip = `Skiller is running ${running.name}. Click to show its graph.`;
            item.command = 'skiller.showRun';
        } else {
            item.text = '$(workflow) Skiller';
            item.tooltip = 'Skiller: show your skills';
            item.command = 'skiller.showSkills';
        }
    };

    render();
    item.show();
    const listener = runs.onDidChangeActive(render);

    return {
        dispose: () => {
            listener.dispose();
            item.dispose();
        },
    };
}
