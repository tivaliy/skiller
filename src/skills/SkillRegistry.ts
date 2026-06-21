/**
 * Skill Registry
 *
 * Manages skill discovery, caching, and lookup.
 * Consolidates all skill discovery operations into a single injectable class.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import {
    Skill,
    SkillSource,
    DiscoveredSkills
} from './types';
import { parseSkill } from './parser';
import type { ParseError } from './types';

/**
 * User-level skills directory
 */
const USER_SKILLS_DIR = path.join(os.homedir(), '.vscode', 'skiller', 'skills');

/**
 * Workspace-level skills directory (namespaced under `.skiller/` so it can't
 * collide with other tools' conventions, e.g. GitHub Actions' `.github/workflows`).
 */
const WORKSPACE_SKILLS_DIR = path.join('.skiller', 'skills');

/**
 * Built-in skills directory name (relative to extension)
 */
const BUILTIN_SKILLS_DIR = 'skills';

/**
 * Result of scanning a skills directory
 */
interface ScanResult {
    skills: Skill[];
    parseErrors: ParseError[];
}

/**
 * Result of refreshing skills with diff information.
 * Used by /reload command to show what changed.
 */
export interface SkillRefreshResult {
    /** Number of skills before refresh */
    beforeCount: number;
    /** Number of skills after refresh */
    afterCount: number;
    /** Skills that were added */
    added: Array<{ id: string; source: SkillSource['type'] }>;
    /** Skill IDs that were removed */
    removed: string[];
    /** Skills that previously had parse errors but now parse correctly */
    parseErrorsFixed: string[];
    /** Skills that now have parse errors */
    newParseErrors: string[];
}

/**
 * Registry for skill discovery and lookup.
 * Caches discovered skills and provides efficient lookup operations.
 */
export class SkillRegistry {
    private readonly extensionPath: string;
    private readonly workspacePath?: string;
    private discovered: DiscoveredSkills | null = null;

    /**
     * Create a new SkillRegistry
     *
     * @param extensionPath - Path to the extension installation
     * @param workspacePath - Optional path to the workspace root
     */
    constructor(extensionPath: string, workspacePath?: string) {
        this.extensionPath = extensionPath;
        this.workspacePath = workspacePath;
    }

    /**
     * Refresh the skill cache by re-discovering all skills.
     *
     * Uses vscode.workspace.fs for remote/virtual filesystem compatibility.
     * Scans directories in parallel for better performance.
     */
    async refresh(): Promise<void> {
        // Scan all directories in parallel for better performance
        const [builtinResult, userResult, workspaceResult] = await Promise.all([
            this.scanBuiltinSkills(),
            this.scanUserSkills(),
            this.workspacePath
                ? this.scanWorkspaceSkills()
                : Promise.resolve({ skills: [], parseErrors: [] })
        ]);

        const { skills, overrides } = this.mergeSkills(
            builtinResult.skills,
            userResult.skills,
            workspaceResult.skills
        );

        const parseErrors: ParseError[] = [
            ...builtinResult.parseErrors,
            ...userResult.parseErrors,
            ...workspaceResult.parseErrors
        ];

        this.discovered = {
            skills,
            builtin: builtinResult.skills,
            user: userResult.skills,
            workspace: workspaceResult.skills,
            overrides,
            parseErrors
        };
    }

    /**
     * Refresh skills and return what changed.
     *
     * Captures the before state, performs a full refresh, then computes
     * the diff. Used by /reload command to show added/removed skills.
     */
    async refreshWithDiff(): Promise<SkillRefreshResult> {
        // Capture before state (handle first run where discovered is null)
        const beforeSkills = this.discovered
            ? new Map(this.discovered.skills)
            : new Map<string, Skill>();
        const beforeCount = beforeSkills.size;
        const beforeParseErrors = new Set(
            this.discovered?.parseErrors.map(e => e.skillId) ?? []
        );

        // Perform full refresh
        await this.refresh();

        // Capture after state (refresh guarantees discovered is set)
        const afterSkills = this.discovered!.skills;
        const afterCount = afterSkills.size;
        const afterParseErrors = new Set(
            this.discovered!.parseErrors.map(e => e.skillId)
        );

        // Compute added/removed skills
        const added: Array<{ id: string; source: SkillSource['type'] }> = [];
        const removed: string[] = [];

        for (const [id, skill] of afterSkills) {
            if (!beforeSkills.has(id)) {
                added.push({ id, source: skill.source.type });
            }
        }

        for (const [id] of beforeSkills) {
            if (!afterSkills.has(id)) {
                removed.push(id);
            }
        }

        // Compute parse error changes
        const parseErrorsFixed = [...beforeParseErrors]
            .filter(id => !afterParseErrors.has(id));
        const newParseErrors = [...afterParseErrors]
            .filter(id => !beforeParseErrors.has(id));

        return {
            beforeCount,
            afterCount,
            added,
            removed,
            parseErrorsFixed,
            newParseErrors
        };
    }

    /**
     * Get discovered skills data.
     *
     * Requires refresh() to have been called first.
     * Returns empty discovery result if not yet initialized.
     */
    private getDiscoveredOrEmpty(): DiscoveredSkills {
        if (!this.discovered) {
            // Return empty result - caller should have called refresh() first
            return {
                skills: new Map(),
                builtin: [],
                user: [],
                workspace: [],
                overrides: [],
                parseErrors: []
            };
        }
        return this.discovered;
    }

    /**
     * Get a skill by ID
     */
    getById(skillId: string): Skill | undefined {
        return this.getDiscoveredOrEmpty().skills.get(skillId);
    }

    /**
     * Get all discovered skills
     */
    getAll(): Skill[] {
        return Array.from(this.getDiscoveredOrEmpty().skills.values());
    }

    /**
     * Get skills grouped by source
     */
    getBySource(): {
        builtin: Skill[];
        user: Skill[];
        workspace: Skill[];
    } {
        const discovered = this.getDiscoveredOrEmpty();
        const result = {
            builtin: [] as Skill[],
            user: [] as Skill[],
            workspace: [] as Skill[]
        };

        for (const skill of discovered.skills.values()) {
            result[skill.source.type].push(skill);
        }

        return result;
    }

    /**
     * Check if a skill exists
     */
    has(skillId: string): boolean {
        return this.getDiscoveredOrEmpty().skills.has(skillId);
    }

    /**
     * Get the number of discovered skills
     */
    get size(): number {
        return this.getDiscoveredOrEmpty().skills.size;
    }

    /**
     * Get parse errors from discovery
     */
    get parseErrors(): ParseError[] {
        return this.getDiscoveredOrEmpty().parseErrors;
    }

    /**
     * Get the raw discovered-skills data (skills, parse errors, and metadata).
     */
    getDiscoveredSkills(): DiscoveredSkills {
        return this.getDiscoveredOrEmpty();
    }

    /**
     * Get the user skills directory path
     */
    getUserSkillsPath(): string {
        return USER_SKILLS_DIR;
    }

    /**
     * Get the workspace skills directory path
     */
    getWorkspaceSkillsPath(): string | undefined {
        return this.workspacePath
            ? path.join(this.workspacePath, WORKSPACE_SKILLS_DIR)
            : undefined;
    }

    /**
     * Check if a skills directory exists.
     *
     * Uses vscode.workspace.fs for remote/virtual filesystem compatibility.
     */
    async skillsDirectoryExists(type: 'user' | 'workspace'): Promise<boolean> {
        const dir = type === 'user'
            ? USER_SKILLS_DIR
            : this.workspacePath
                ? path.join(this.workspacePath, WORKSPACE_SKILLS_DIR)
                : null;

        if (!dir) return false;

        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(dir));
            return true;
        } catch {
            return false;
        }
    }

    // Private methods for scanning

    private async scanBuiltinSkills(): Promise<ScanResult> {
        const skillsDir = path.join(this.extensionPath, BUILTIN_SKILLS_DIR);
        return this.scanSkillsDirectory(skillsDir, 'builtin');
    }

    private async scanUserSkills(): Promise<ScanResult> {
        return this.scanSkillsDirectory(USER_SKILLS_DIR, 'user');
    }

    private async scanWorkspaceSkills(): Promise<ScanResult> {
        if (!this.workspacePath) {
            return { skills: [], parseErrors: [] };
        }
        const skillsDir = path.join(this.workspacePath, WORKSPACE_SKILLS_DIR);
        return this.scanSkillsDirectory(skillsDir, 'workspace');
    }

    /**
     * True for a directory, including a symlink that points at one. VS Code's
     * FileType is a bitmask (a symlinked dir is `Directory | SymbolicLink`), so a
     * strict `=== Directory` check would skip symlinked skills dirs.
     */
    private isDirectory(type: vscode.FileType): boolean {
        return (type & vscode.FileType.Directory) !== 0;
    }

    /**
     * Scan a directory for skill definitions.
     *
     * Uses vscode.workspace.fs for remote/virtual filesystem compatibility.
     * Parses skills in parallel for better performance.
     */
    private async scanSkillsDirectory(
        directory: string,
        sourceType: SkillSource['type']
    ): Promise<ScanResult> {
        const dirUri = vscode.Uri.file(directory);

        // Check if directory exists first to avoid noisy error logs
        // (readDirectory logs ENOENT errors internally before rejecting)
        try {
            const stat = await vscode.workspace.fs.stat(dirUri);
            if (!this.isDirectory(stat.type)) {
                return { skills: [], parseErrors: [] };
            }
        } catch {
            // Directory doesn't exist - return empty result silently
            return { skills: [], parseErrors: [] };
        }

        try {
            // Read directory entries (safe - we confirmed directory exists)
            const entries = await vscode.workspace.fs.readDirectory(dirUri);

            // Filter to directories that might contain skills
            const skillDirs = entries
                .filter(([name, fileType]) =>
                    this.isDirectory(fileType) &&
                    !name.startsWith('.') &&
                    name !== 'node_modules'
                )
                .map(([name]) => path.join(directory, name));

            // Parse all skills in parallel for better performance
            const results = await Promise.all(
                skillDirs.map(async (skillDir) => {
                    const source: SkillSource = {
                        type: sourceType,
                        path: skillDir
                    };
                    return parseSkill(skillDir, source);
                })
            );

            // Separate successes and failures
            const skills: Skill[] = [];
            const parseErrors: ParseError[] = [];

            for (const result of results) {
                if (result.success) {
                    skills.push(result.skill);
                } else if (result.error.error !== 'skill.yaml not found') {
                    // Only report errors for directories that have skill.yaml but failed to parse
                    // Skip directories without skill.yaml (they're not skills)
                    parseErrors.push(result.error);
                }
            }

            return { skills, parseErrors };
        } catch {
            // Directory doesn't exist or can't be read - return empty result
            return { skills: [], parseErrors: [] };
        }
    }

    private mergeSkills(
        builtin: Skill[],
        user: Skill[],
        workspace: Skill[]
    ): {
        skills: Map<string, Skill>;
        overrides: Array<{ skillId: string; overrides: 'builtin' | 'user' }>;
    } {
        const skills = new Map<string, Skill>();
        const overrides: Array<{ skillId: string; overrides: 'builtin' | 'user' }> = [];

        for (const skill of builtin) {
            skills.set(skill.id, skill);
        }

        for (const skill of user) {
            if (skills.has(skill.id)) {
                overrides.push({ skillId: skill.id, overrides: 'builtin' });
                skill.source.overrides = 'builtin';
            }
            skills.set(skill.id, skill);
        }

        for (const skill of workspace) {
            const existing = skills.get(skill.id);
            if (existing) {
                const overrideType = existing.source.type === 'user' ? 'user' : 'builtin';
                overrides.push({ skillId: skill.id, overrides: overrideType });
                skill.source.overrides = overrideType;
            }
            skills.set(skill.id, skill);
        }

        return { skills, overrides };
    }
}
