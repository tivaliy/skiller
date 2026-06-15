/**
 * Skill Graph Module
 *
 * Public API for visualizing skills as state diagrams.
 *
 * Usage:
 *   import { showSkillGraph } from './skills/graph';
 *   showSkillGraph(skill);
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type {Skill, SkillSource} from '../types';
import {parseSkillFromContent} from '../parser';
import {validateSkill} from '../validators';
import {SkillGraphBuilder} from './builder';
import {StateRenderer} from './state-renderer';
import {type WebviewOptions, WebviewRenderer} from './webview-renderer';
import {panelManager} from './panel-manager';
import type {RenderOptions, SkillGraph, WebviewMessage} from './types';
import type {ValidationIssue} from '../validators';

// ============================================================================
// Validation Display Helpers
// ============================================================================

/**
 * Display validation errors in panel
 *
 * @param skillId - Skill to show errors for
 * @param errors - Error issues to display
 * @param logPrefix - Optional prefix for debug logging
 * @returns true if any errors were displayed
 */
function showValidationErrors(
    skillId: string,
    errors: readonly ValidationIssue[],
    logPrefix?: string
): boolean {
    if (errors.length === 0) return false;

    const formatted = errors.map(e => `• ${e.message}`).join('\n');
    if (logPrefix) {
        console.debug(`${logPrefix} Validation errors for ${skillId}:`, formatted);
    }
    panelManager.showError(skillId, 'Validation Error', formatted);
    return true;
}

/**
 * Display validation warnings in panel
 *
 * @param skillId - Skill to show warnings for
 * @param warnings - Warning issues to display
 * @param logPrefix - Optional prefix for debug logging
 * @returns true if any warnings were displayed
 */
function showValidationWarnings(
    skillId: string,
    warnings: readonly ValidationIssue[],
    logPrefix?: string
): boolean {
    if (warnings.length === 0) return false;

    const formatted = warnings.map(w => `• ${w.message}`).join('\n');
    if (logPrefix) {
        console.debug(`${logPrefix} Validation warnings for ${skillId}:`, formatted);
    }
    panelManager.showWarning(skillId, 'Validation Warning', formatted, warnings.length);
    return true;
}

// Re-export types for consumers
export type {
    SkillGraph,
    GraphNode,
    GraphEdge,
    NodeType,
    EdgeType,
    GraphRenderer,
    RenderOptions,
    NodeMetadata
} from './types';

export { SkillGraphBuilder } from './builder';
export { StateRenderer, type RenderResult } from './state-renderer';
export { WebviewRenderer } from './webview-renderer';
export { panelManager, SkillGraphPanelManager } from './panel-manager';
// enableLiveReload is exported from this file directly (see below)

/**
 * Show a skill graph in a VSCode WebviewPanel
 *
 * This is the main entry point for displaying skill graphs.
 * It builds the graph, renders it to Mermaid syntax, and displays it.
 * Clicking on a node navigates to the corresponding step in skill.yaml.
 *
 * Features:
 * - Panel reuse: reopening same skill reuses existing panel
 * - Click-to-navigate: clicking nodes opens skill.yaml at that step
 * - Bundled assets: works offline, no CDN dependency
 *
 * @param skill - The skill to visualize
 * @param extensionUri - Extension URI for resolving bundled assets
 * @param options - Optional rendering and display options
 * @returns The created or reused WebviewPanel
 *
 * @example
 * ```typescript
 * import { showSkillGraph } from './skills/graph';
 *
 * const skill = skillRegistry.getById('my-skill');
 * if (skill) {
 *   showSkillGraph(skill, context.extensionUri);
 * }
 * ```
 */
export async function showSkillGraph(
    skill: Skill,
    extensionUri: vscode.Uri,
    options: {
        render?: RenderOptions;
        webview?: WebviewOptions;
    } = {}
): Promise<vscode.WebviewPanel> {
    // Build intermediate graph representation
    const builder = new SkillGraphBuilder();
    const graph = builder.build(skill);

    // Render to Mermaid state diagram syntax with ID mapping for navigation
    const renderer = new StateRenderer(options.render);
    const { mermaidCode, idMapping, nodeMetadata } = renderer.renderWithMapping(graph);

    // Check if panel already exists for this skill
    const existingPanel = panelManager.getPanel(skill.id);
    if (existingPanel) {
        // Clear old messages, update content, reveal
        panelManager.clearMessages(skill.id);
        panelManager.updatePanel(skill.id, mermaidCode, idMapping, nodeMetadata);
        panelManager.revealPanel(skill.id);

        // Show validation issues (errors and warnings)
        const validation = await validateSkill(skill, { validateStepFiles: false });
        showValidationErrors(skill.id, validation.errors);
        showValidationWarnings(skill.id, validation.warnings);

        return existingPanel;
    }

    // Kick off validation concurrently with panel/webview creation — its result is
    // only needed once the webview signals 'ready', so there's no reason to block
    // first paint on it. Posting on 'ready' (rather than a setTimeout) avoids racing
    // the first render.
    const validationPromise = validateSkill(skill, { validateStepFiles: false });
    let validationShown = false;

    // Create new panel with ID mapping for click-to-navigate
    const webviewRenderer = new WebviewRenderer(extensionUri);
    const panel = webviewRenderer.show(skill.name, mermaidCode, {
        ...options.webview,
        idMapping,
        nodeMetadata
    });

    // Message handler: navigation + one-time validation display on first 'ready'.
    // 'ready' fires on both render success and failure, so diagnostics are never
    // silently dropped for an un-renderable diagram.
    const handleMessage = (message: WebviewMessage): void => {
        if (message.type === 'navigate') {
            void navigateToStep(skill.source.path, message.stepId);
        } else if (message.type === 'ready' && !validationShown) {
            validationShown = true;
            void validationPromise.then(validation => {
                showValidationErrors(skill.id, validation.errors);
                showValidationWarnings(skill.id, validation.warnings);
            });
        }
    };

    // Register panel with manager (handles lifecycle and message subscription)
    panelManager.register(skill.id, skill, panel, handleMessage);

    return panel;
}

/**
 * Navigate to a step definition in skill.yaml.
 * Uses vscode.workspace.fs for remote/virtual filesystem compatibility.
 */
async function navigateToStep(skillDir: string, stepId: string): Promise<void> {
    const skillYamlUri = vscode.Uri.file(path.join(skillDir, 'skill.yaml'));

    try {
        await vscode.workspace.fs.stat(skillYamlUri);
    } catch {
        void vscode.window.showErrorMessage(`skill.yaml not found: ${skillDir}`);
        return;
    }

    // Open the document first to get current content (including unsaved changes)
    const document = await vscode.workspace.openTextDocument(skillYamlUri);
    const content = document.getText();

    // Handle special navigation targets
    let lineNumber: number;
    if (stepId === '__inputs__') {
        lineNumber = findSectionLineInContent(content, 'inputs');
    } else if (stepId === '__output__') {
        lineNumber = findSectionLineInContent(content, 'output');
    } else {
        lineNumber = findStepLineInContent(content, stepId);
    }

    if (lineNumber < 0) {
        const target = stepId.startsWith('__') ? stepId.slice(2, -2) : `Step "${stepId}"`;
        void vscode.window.showWarningMessage(`${target} not found in skill.yaml`);
        return;
    }

    // Show the document
    const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false
    });

    // Navigate to the line
    const position = new vscode.Position(lineNumber, 0);
    const range = new vscode.Range(position, position);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

/**
 * Find the line number of a top-level section in content
 * Returns 0-based line number, or -1 if not found
 */
function findSectionLineInContent(content: string, section: string): number {
    const lines = content.split('\n');

    // Match top-level section (no leading whitespace)
    const sectionPattern = new RegExp(`^${section}:\\s*(?:#.*)?$`);

    for (let i = 0; i < lines.length; i++) {
        if (sectionPattern.test(lines[i])) {
            return i;
        }
    }

    return -1;
}

/**
 * Find the line number of a step in content
 * Returns 0-based line number, or -1 if not found
 */
function findStepLineInContent(content: string, stepId: string): number {
    const lines = content.split('\n');

    // Only match step IDs (list items with "- id:"), not the top-level skill id
    // Format: "  - id: stepId" with optional leading whitespace
    // Also allow optional quotes and trailing comments.
    const stepPattern = new RegExp(
        `^\\s+-\\s*id:\\s*(?:["']?)${escapeRegex(stepId)}(?:["']?)\\s*(?:#.*)?$`
    );

    for (let i = 0; i < lines.length; i++) {
        if (stepPattern.test(lines[i])) {
            return i;
        }
    }

    return -1;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Re-render every open graph panel from the current registry.
 *
 * Used by `/reload`: an edited skill that is still present must have its open
 * panel refreshed (not just removed skills closed), otherwise the panel keeps
 * rendering the stale pre-edit diagram (S-11). Panels whose skill no longer
 * exists are closed; the rest are updated in place (no reveal, so focus isn't
 * stolen). Reflects on-disk state, since the registry was just refreshed from disk.
 *
 * @param getSkillById - Lookup into the freshly-refreshed registry
 */
export async function refreshOpenPanels(
    getSkillById: (skillId: string) => Skill | undefined
): Promise<void> {
    for (const skillId of panelManager.getOpenSkillIds()) {
        const skill = getSkillById(skillId);
        if (!skill) {
            panelManager.closePanel(skillId);
            continue;
        }

        const builder = new SkillGraphBuilder();
        const graph = builder.build(skill);
        const renderer = new StateRenderer();
        const { mermaidCode, idMapping, nodeMetadata } = renderer.renderWithMapping(graph);

        panelManager.clearMessages(skillId);
        panelManager.updatePanel(skillId, mermaidCode, idMapping, nodeMetadata);

        const validation = await validateSkill(skill, { validateStepFiles: false });
        showValidationErrors(skillId, validation.errors, '[Reload]');
        showValidationWarnings(skillId, validation.warnings, '[Reload]');
    }
}

/**
 * Build a SkillGraph from a Skill (for custom rendering)
 *
 * Use this when you need the intermediate graph representation
 * without rendering it immediately.
 *
 * @param skill - The skill to build a graph from
 * @returns The intermediate graph representation
 */
export function buildSkillGraph(skill: Skill): SkillGraph {
    const builder = new SkillGraphBuilder();
    return builder.build(skill);
}

/**
 * Generate Mermaid syntax from a Skill
 *
 * Use this when you need the Mermaid code without displaying it
 * (e.g., for embedding in documentation or tests).
 *
 * @param skill - The skill to generate Mermaid for
 * @param options - Rendering options
 * @returns Mermaid state diagram syntax
 */
export function generateMermaid(skill: Skill, options?: RenderOptions): string {
    const builder = new SkillGraphBuilder();
    const graph = builder.build(skill);

    const renderer = new StateRenderer(options);
    return renderer.render(graph);
}

// ============================================================================
// Live Reload
// ============================================================================

/** Debounce timers for live reload (per skill) */
const liveReloadTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Live reload debounce delay in ms */
const LIVE_RELOAD_DEBOUNCE = 300;

/**
 * Enable live reload for skill graphs
 *
 * When enabled, graph panels automatically update when the corresponding
 * skill.yaml file is modified in the editor.
 *
 * @returns Disposable to disable live reload
 *
 * @example
 * ```typescript
 * // In extension activation
 * context.subscriptions.push(enableLiveReload());
 * ```
 */
export function enableLiveReload(): vscode.Disposable {
    const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
        const doc = event.document;

        // Only care about skill.yaml files
        if (!doc.fileName.endsWith('skill.yaml')) {
            return;
        }

        // Find skill ID from path
        const skillDir = path.dirname(doc.fileName);
        const skillId = findSkillIdByPath(skillDir);

        // No open panel for this skill
        if (!skillId) {
            return;
        }

        // Debounce updates
        const existingTimer = liveReloadTimers.get(skillId);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        const timer = setTimeout(() => {
            liveReloadTimers.delete(skillId);
            void updateGraphFromContent(skillId, skillDir, doc.getText());
        }, LIVE_RELOAD_DEBOUNCE);

        liveReloadTimers.set(skillId, timer);
    });

    // Dispose the watcher AND clear any pending debounce timers so they can't
    // fire after disposal (e.g. on extension deactivate).
    return {
        dispose: () => {
            subscription.dispose();
            for (const timer of liveReloadTimers.values()) {
                clearTimeout(timer);
            }
            liveReloadTimers.clear();
        }
    };
}

/**
 * Find skill ID by matching skill path with open panels
 */
function findSkillIdByPath(skillDir: string): string | undefined {
    for (const skillId of panelManager.getOpenSkillIds()) {
        const panelPath = panelManager.getSkillPath(skillId);
        if (panelPath === skillDir) {
            return skillId;
        }
    }
    return undefined;
}

/**
 * Update graph panel from YAML content
 */
async function updateGraphFromContent(skillId: string, skillDir: string, content: string): Promise<void> {
    // Clear any previous validation messages before showing new results
    // This prevents stale errors/warnings from persisting across edits
    panelManager.clearMessages(skillId);

    // Create a minimal source for parsing
    const source: SkillSource = {
        type: 'workspace',
        path: skillDir
    };

    // Parse skill from content
    const result = parseSkillFromContent(content, skillDir, source);

    if (!result.success) {
        // Show error in panel, keep last valid graph
        const errorMessage = result.error?.error ?? 'Unknown parse error';
        console.debug(`[LiveReload] Parse error for ${skillId}:`, errorMessage);
        panelManager.showError(skillId, 'YAML Parse Error', errorMessage);
        return;
    }

    // Validate skill structure (skip file existence checks - files may not exist yet)
    const validation = await validateSkill(result.skill, { validateStepFiles: false });

    // Show all validation issues (errors and warnings together)
    const hasErrors = showValidationErrors(skillId, validation.errors, '[LiveReload]');
    showValidationWarnings(skillId, validation.warnings, '[LiveReload]');

    // Errors block graph update (keep last valid graph visible)
    if (hasErrors) {
        return;
    }

    // Rebuild graph
    const builder = new SkillGraphBuilder();
    const graph = builder.build(result.skill);

    // Render to Mermaid
    const renderer = new StateRenderer();
    const { mermaidCode, idMapping, nodeMetadata } = renderer.renderWithMapping(graph);

    // Update panel
    panelManager.updatePanel(skillId, mermaidCode, idMapping, nodeMetadata);
}
