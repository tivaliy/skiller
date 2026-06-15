/**
 * Tool Availability Check
 *
 * Validates that all tools referenced in a skill actually exist.
 * This includes:
 * - Tool aliases defined in skill.yaml
 * - Tools referenced in step definitions
 *
 * Optionality is determined by the `?` suffix:
 * - Tools without `?` → errors if missing
 * - Tools with `?` suffix → warnings if missing
 */

import type { Skill, SkillStep } from '../../types';
import type { ToolResolver, MissingToolInfo } from '../../tool-resolver';
import { parseAliasValue } from '../../parser';
import type {
    ReadinessCheck,
    ReadinessContext,
    ReadinessIssue,
    ToolAvailabilityResult
} from '../types';

/**
 * Check that all tool references in a skill can be resolved
 *
 * Validates:
 * 1. All tool aliases point to existing MCP tools
 * 2. All tools referenced in steps exist
 */
export class ToolAvailabilityCheck implements ReadinessCheck {
    readonly id = 'tool-availability';
    readonly name = 'Tool Availability Check';

    constructor(private readonly toolResolver: ToolResolver) {}

    check(skill: Skill, _context: ReadinessContext): ToolAvailabilityResult {
        const issues: ReadinessIssue[] = [];
        const allMissingTools: MissingToolInfo[] = [];

        // 1. Validate all tool aliases
        // We need to validate the actual tool names (strip ? suffix)
        const aliasEntries = Object.entries(skill.tools.aliases);
        if (aliasEntries.length > 0) {
            for (const [aliasName, aliasValue] of aliasEntries) {
                const { toolName, optional } = parseAliasValue(aliasValue);
                const tool = this.toolResolver.findTool(toolName);

                if (!tool) {
                    const category = this.extractCategory(toolName);
                    const missing: MissingToolInfo = {
                        alias: aliasName,
                        resolvedName: toolName,
                        category,
                        optional
                    };

                    allMissingTools.push(missing);

                    issues.push({
                        checkId: this.id,
                        severity: optional ? 'warning' : 'error',
                        message: `Tool alias '${aliasName}' points to '${toolName}' which is not available`,
                        suggestion: optional
                            ? `This is an optional tool. Skill will run with reduced functionality.`
                            : this.formatMissingSuggestion(toolName, category)
                    });
                }
            }
        }

        // 2. Validate tools referenced in each step
        for (const step of skill.steps) {
            const stepMissing = this.validateStepTools(step, skill);

            for (const { missing, issue } of stepMissing) {
                // Avoid duplicates (same tool might be used in multiple steps)
                const alreadyReported = allMissingTools.some(
                    m => m.resolvedName === missing.resolvedName
                );

                if (!alreadyReported) {
                    allMissingTools.push(missing);
                    issues.push(issue);
                }
            }
        }

        return {
            ready: issues.filter(i => i.severity === 'error').length === 0,
            issues,
            missingTools: allMissingTools
        };
    }

    /**
     * Validate tools referenced in a single step
     */
    private validateStepTools(
        step: SkillStep,
        skill: Skill
    ): Array<{ missing: MissingToolInfo; issue: ReadinessIssue }> {
        const results: Array<{ missing: MissingToolInfo; issue: ReadinessIssue }> = [];

        // Check step.tools array (for LLM steps)
        if (step.tools && step.tools.length > 0) {
            const validation = this.toolResolver.validateReferences(
                step.tools,
                skill.tools.aliases
            );

            for (const missing of validation.missing) {
                results.push({
                    missing,
                    issue: {
                        checkId: this.id,
                        severity: missing.optional ? 'warning' : 'error',
                        message: missing.alias
                            ? `Step '${step.id}' references tool '${missing.alias}' → '${missing.resolvedName}' which is not available`
                            : `Step '${step.id}' references tool '${missing.resolvedName}' which is not available`,
                        suggestion: missing.optional
                            ? `This is an optional tool. Step will run without it.`
                            : this.formatMissingSuggestion(missing.resolvedName, missing.category)
                    }
                });
            }
        }

        // Check step.tool (for tool steps)
        if (step.tool) {
            // Resolve through alias if it exists
            const isAlias = step.tool in skill.tools.aliases;
            let toolName: string;
            let optional: boolean;

            if (isAlias) {
                const parsed = parseAliasValue(skill.tools.aliases[step.tool]);
                toolName = parsed.toolName;
                optional = parsed.optional;
            } else if (step.tool.endsWith('?')) {
                // Direct tool name with ? suffix
                toolName = step.tool.slice(0, -1);
                optional = true;
            } else {
                toolName = step.tool;
                optional = false;
            }

            const tool = this.toolResolver.findTool(toolName);

            if (!tool) {
                const category = this.extractCategory(toolName);
                const missing: MissingToolInfo = {
                    alias: isAlias ? step.tool : undefined,
                    resolvedName: toolName,
                    category,
                    optional
                };

                results.push({
                    missing,
                    issue: {
                        checkId: this.id,
                        severity: optional ? 'warning' : 'error',
                        message: missing.alias
                            ? `Tool step '${step.id}' requires '${missing.alias}' → '${toolName}' which is not available`
                            : `Tool step '${step.id}' requires '${toolName}' which is not available`,
                        suggestion: optional
                            ? `This is an optional tool. Step will be skipped.`
                            : this.formatMissingSuggestion(toolName, category)
                    }
                });
            }
        }

        return results;
    }

    /**
     * Extract MCP category from tool name
     */
    private extractCategory(toolName: string): string {
        const underscoreIndex = toolName.indexOf('_');
        if (underscoreIndex > 0) {
            return toolName.substring(0, underscoreIndex);
        }
        return 'unknown';
    }

    /**
     * Format a helpful suggestion for missing tools
     */
    private formatMissingSuggestion(toolName: string, category: string): string {
        if (category === 'unknown') {
            return `Tool '${toolName}' is not registered. Check the tool name or ensure it's available.`;
        }
        return `Ensure the MCP server providing '${category}' tools is running and configured`;
    }
}
