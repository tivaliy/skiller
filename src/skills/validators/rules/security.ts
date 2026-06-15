/**
 * Security Phase Validators
 *
 * Validates security concerns:
 * - Path traversal in file references
 * - Invalid/dangerous characters in IDs
 * - Input constraints for safety
 */

import * as path from 'path';
import type { ValidationPhase } from '../types';
import { BaseValidator } from '../engine';
import type { ValidationContext } from '../context';

const PHASE: ValidationPhase = 'security';

// ============================================================================
// Path Traversal Validator
// ============================================================================

/**
 * Validates step file paths don't traverse outside skill directory
 */
export class PathTraversalValidator extends BaseValidator {
    readonly id = 'security/path-traversal';
    readonly name = 'Path Traversal Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        const skillDir = ctx.skill.source.path;

        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];
            if (!step.file) continue;

            // Check for absolute paths
            if (path.isAbsolute(step.file)) {
                ctx.addError(
                    this.id,
                    this.phase,
                    'security',
                    `Step '${step.id}' uses absolute path: '${step.file}'`,
                    this.stepLocation(i, 'file'),
                    'Use relative paths within the skill directory'
                );
                continue;
            }

            // Check for path traversal attempts
            if (step.file.includes('..')) {
                ctx.addError(
                    this.id,
                    this.phase,
                    'security',
                    `Step '${step.id}' contains path traversal sequence '..': '${step.file}'`,
                    this.stepLocation(i, 'file'),
                    'Step files must be within the skill directory - remove path traversal'
                );
                continue;
            }

            // Verify resolved path is within skill directory
            try {
                const resolvedPath = path.resolve(skillDir, step.file);
                const normalizedSkillDir = path.resolve(skillDir);

                if (!resolvedPath.startsWith(normalizedSkillDir + path.sep) &&
                    resolvedPath !== normalizedSkillDir) {
                    ctx.addError(
                        this.id,
                        this.phase,
                        'security',
                        `Step '${step.id}' file resolves outside skill directory`,
                        this.stepLocation(i, 'file'),
                        'Step files must be within the skill directory'
                    );
                }
            } catch {
                // Path resolution failed - likely invalid path
                ctx.addWarning(
                    this.id,
                    this.phase,
                    'security',
                    `Step '${step.id}' has potentially invalid file path: '${step.file}'`,
                    this.stepLocation(i, 'file')
                );
            }

            // Check for Windows-style absolute paths on any platform
            if (/^[a-zA-Z]:/.test(step.file)) {
                ctx.addError(
                    this.id,
                    this.phase,
                    'security',
                    `Step '${step.id}' uses Windows absolute path: '${step.file}'`,
                    this.stepLocation(i, 'file'),
                    'Use relative paths for cross-platform compatibility'
                );
            }

            // Check for URL-like paths
            if (/^(https?|file|ftp):\/\//i.test(step.file)) {
                ctx.addError(
                    this.id,
                    this.phase,
                    'security',
                    `Step '${step.id}' uses URL as file path: '${step.file}'`,
                    this.stepLocation(i, 'file'),
                    'Step files must be local files within the skill directory'
                );
            }
        }
    }
}

// ============================================================================
// ID Characters Validator
// ============================================================================

/**
 * Validates IDs don't contain dangerous characters
 */
export class IdCharactersValidator extends BaseValidator {
    readonly id = 'security/id-characters';
    readonly name = 'ID Characters Validator';
    readonly phase = PHASE;

    // Characters that could cause issues in various contexts
    private readonly DANGEROUS_PATTERNS = [
        { pattern: /[\x00-\x1f]/, name: 'control characters', severity: 'error' as const },
        { pattern: /<script/i, name: 'script tags', severity: 'error' as const },
        { pattern: /javascript:/i, name: 'javascript protocol', severity: 'error' as const },
        { pattern: /on\w+\s*=/i, name: 'event handlers', severity: 'error' as const },
        { pattern: /[\u0000]/, name: 'null bytes', severity: 'error' as const },
        { pattern: /[\u200b-\u200f\u2028-\u202f]/, name: 'invisible unicode', severity: 'warning' as const },
        { pattern: /[<>'"&]/, name: 'HTML special characters', severity: 'warning' as const },
        { pattern: /[\u0080-\u009f]/, name: 'C1 control characters', severity: 'warning' as const },
    ];

    validate(ctx: ValidationContext): void {
        // Validate step IDs
        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];
            this.validateId(ctx, step.id, 'Step', this.stepLocation(i, 'id'));

            // Validate output variable names
            if (step.output) {
                this.validateId(ctx, step.output, 'Output variable', this.stepLocation(i, 'output'));
            }
        }

        // Validate input names
        for (let i = 0; i < ctx.skill.inputs.length; i++) {
            const input = ctx.skill.inputs[i];
            this.validateId(ctx, input.name, 'Input', this.inputLocation(i, 'name'));
        }

        // Validate skill ID
        this.validateId(ctx, ctx.skill.id, 'Skill', { field: 'id' });
    }

    private validateId(
        ctx: ValidationContext,
        id: string,
        idType: string,
        location: { field: string }
    ): void {
        for (const { pattern, name, severity } of this.DANGEROUS_PATTERNS) {
            if (pattern.test(id)) {
                const message = `${idType} ID '${this.sanitizeForDisplay(id)}' contains ${name}`;

                if (severity === 'error') {
                    ctx.addError(this.id, this.phase, 'security', message, location, 'Remove dangerous characters from the ID');
                } else {
                    ctx.addWarning(this.id, this.phase, 'security', message, location, 'Consider removing special characters for better compatibility');
                }
            }
        }

        // Check for extremely long IDs (potential buffer issues)
        if (id.length > 256) {
            ctx.addWarning(
                this.id,
                this.phase,
                'security',
                `${idType} ID is unusually long (${id.length} characters)`,
                location,
                'Consider using shorter, more descriptive IDs'
            );
        }
    }

    /**
     * Sanitize ID for safe display in error messages
     */
    private sanitizeForDisplay(id: string): string {
        return id
            .replace(/[\x00-\x1f]/g, '?') // Replace control chars
            .replace(/[\u0000]/g, '\\0')  // Show null bytes
            .substring(0, 50) + (id.length > 50 ? '...' : '');
    }
}

// ============================================================================
// Input Constraints Validator
// ============================================================================

/**
 * Validates input definitions have reasonable constraints
 */
export class InputConstraintsValidator extends BaseValidator {
    readonly id = 'security/input-constraints';
    readonly name = 'Input Constraints Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        for (let i = 0; i < ctx.skill.inputs.length; i++) {
            const input = ctx.skill.inputs[i];

            // Warn about string inputs without constraints
            if ((input.type === 'string' || !input.type) && !input.pattern && !input.enum) {
                // This is just info, not a warning - many string inputs are fine unconstrained
                ctx.addInfo(
                    this.id,
                    this.phase,
                    'security',
                    `Input '${input.name}' is an unconstrained string - consider adding pattern or enum validation`,
                    this.inputLocation(i)
                );
            }

            // Check for overly permissive regex patterns
            if (input.pattern) {
                this.validatePattern(ctx, input.pattern, input.name, i);
            }

            // Check enum values for suspicious content
            if (input.enum) {
                this.validateEnumValues(ctx, input.enum, input.name, i);
            }

            // Check default values for suspicious content
            if (input.default !== undefined && typeof input.default === 'string') {
                this.validateStringValue(ctx, input.default, `Input '${input.name}' default`, i);
            }
        }
    }

    private validatePattern(ctx: ValidationContext, pattern: string, inputName: string, index: number): void {
        // Warn about patterns that accept everything
        const tooPermissive = ['.*', '.+', '[\\s\\S]*', '[\\s\\S]+', '(.*)'];
        if (tooPermissive.includes(pattern)) {
            ctx.addInfo(
                this.id,
                this.phase,
                'security',
                `Input '${inputName}' has pattern '${pattern}' which accepts almost any input`,
                this.inputLocation(index, 'pattern')
            );
        }

        // Check for ReDoS-vulnerable patterns (catastrophic backtracking)
        const redosPatterns = [
            /\(.*\+\)\+/, // (a+)+
            /\(.*\*\)\*/, // (a*)*
            /\(.*\+\)\*/, // (a+)*
            /\(.*\*\)\+/, // (a*)+
        ];

        for (const redos of redosPatterns) {
            if (redos.test(pattern)) {
                ctx.addWarning(
                    this.id,
                    this.phase,
                    'security',
                    `Input '${inputName}' pattern may be vulnerable to ReDoS (catastrophic backtracking)`,
                    this.inputLocation(index, 'pattern'),
                    'Review the regex for nested quantifiers that could cause exponential matching'
                );
                break;
            }
        }
    }

    private validateEnumValues(ctx: ValidationContext, enumValues: string[], inputName: string, index: number): void {
        for (const value of enumValues) {
            this.validateStringValue(ctx, value, `Input '${inputName}' enum value '${value}'`, index);
        }
    }

    private validateStringValue(ctx: ValidationContext, value: string, description: string, index: number): void {
        // Check for potential template injection
        if (value.includes('{{') || value.includes('{%')) {
            ctx.addWarning(
                this.id,
                this.phase,
                'security',
                `${description} contains template syntax which may cause interpolation issues`,
                this.inputLocation(index),
                'Ensure template syntax in defaults/enums is intentional'
            );
        }

        // Check for shell metacharacters that might be dangerous if passed to shell
        const shellMeta = /[;&|`$(){}[\]<>\\!]/;
        if (shellMeta.test(value)) {
            ctx.addInfo(
                this.id,
                this.phase,
                'security',
                `${description} contains shell metacharacters - ensure proper escaping if used in commands`,
                this.inputLocation(index)
            );
        }
    }
}

// ============================================================================
// Tool Params Path Validator
// ============================================================================

/**
 * Flags literal path traversal / absolute paths in tool-step params (S-06).
 *
 * Tool steps drive file writes and MCP side effects, so their params — not the
 * markdown prompt path — are the actual dangerous surface. Templated values
 * ({{ ... }}) can't be analyzed statically and are bounded at runtime (see
 * resolvePath, S-05); this catches obvious *literal* escapes at author time.
 * Warning severity, since the runtime enforces the hard boundary.
 */
export class ToolParamsPathValidator extends BaseValidator {
    readonly id = 'security/tool-params-path';
    readonly name = 'Tool Params Path Validator';
    readonly phase = PHASE;

    validate(ctx: ValidationContext): void {
        for (let i = 0; i < ctx.skill.steps.length; i++) {
            const step = ctx.skill.steps[i];
            if (step.type !== 'tool' || !step.params) continue;
            this.scan(ctx, step.id, i, step.params, 'params');
        }
    }

    private scan(
        ctx: ValidationContext,
        stepId: string,
        index: number,
        value: unknown,
        keyPath: string
    ): void {
        if (typeof value === 'string') {
            this.checkString(ctx, stepId, index, keyPath, value);
        } else if (Array.isArray(value)) {
            value.forEach((item, j) => this.scan(ctx, stepId, index, item, `${keyPath}[${j}]`));
        } else if (value && typeof value === 'object') {
            for (const [key, val] of Object.entries(value)) {
                this.scan(ctx, stepId, index, val, `${keyPath}.${key}`);
            }
        }
    }

    private checkString(
        ctx: ValidationContext,
        stepId: string,
        index: number,
        keyPath: string,
        raw: string
    ): void {
        // Strip template expressions before scanning for literal traversal.
        const literal = raw.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, '');
        const hasTraversal = /(^|[\\/])\.\.([\\/]|$)/.test(literal);
        // Check absoluteness on the RAW string start so a leading template
        // (e.g. "{{ inputs.dir }}/file") isn't mistaken for an absolute path.
        const startsAbsolute = /^\s*(\/|~|[a-zA-Z]:[\\/])/.test(raw);

        if (hasTraversal || startsAbsolute) {
            ctx.addWarning(
                this.id,
                this.phase,
                'security',
                `Step '${stepId}': param '${keyPath}' contains a literal ${hasTraversal ? 'path-traversal sequence' : 'absolute path'} ('${raw}') that may write outside the workspace`,
                this.stepLocation(index, 'params'),
                'Use a workspace-relative path, or enable "skiller.skills.allowOutsideWorkspaceWrites" if intentional'
            );
        }
    }
}

// ============================================================================
// Export All Security Validators
// ============================================================================

export const securityValidators = [
    new PathTraversalValidator(),
    new IdCharactersValidator(),
    new InputConstraintsValidator(),
    new ToolParamsPathValidator()
];
