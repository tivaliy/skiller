/**
 * Built-in-Only Tools Check
 *
 * Some Skiller tools skip the per-call confirmation inside built-in runs, because
 * only Skiller's own built-in skills may call them (skiller_writeSkill, used by
 * skill-creator).
 * A workspace or user skill may come from an untrusted repository, so
 * referencing one of these tools there is a readiness error: the skill can't run.
 */

import type { Skill } from '../../types';
import { builtinOnlyToolMessage, builtinOnlyToolsUsedBy } from '../../reserved-tools';
import type { ReadinessCheck, ReadinessCheckResult, ReadinessContext } from '../types';

export class BuiltinOnlyToolsCheck implements ReadinessCheck {
    readonly id = 'builtin-only-tools';
    readonly name = 'Built-in-Only Tools Check';

    check(skill: Skill, _context: ReadinessContext): ReadinessCheckResult {
        if (skill.source.type === 'builtin') {
            return { ready: true, issues: [] };
        }
        const issues = builtinOnlyToolsUsedBy(skill).map((name) => ({
            checkId: this.id,
            severity: 'error' as const,
            message: builtinOnlyToolMessage(name),
            suggestion: 'Remove it from tools.aliases and the steps. To create skills, use **Skiller: New Skill…**.',
        }));
        return { ready: issues.length === 0, issues };
    }
}
