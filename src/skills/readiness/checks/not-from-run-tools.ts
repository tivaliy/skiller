/**
 * Not-From-Run Tools Check
 *
 * skiller_runSkill and skiller_listSkills are for agents outside a Skiller run.
 * Called from inside one, skiller_runSkill would ask to replace the run that is
 * waiting on it, losing both. Referencing either in skill.yaml is a readiness
 * error for every skill, built-ins included.
 */

import type { Skill } from '../../types';
import { notFromRunToolMessage, notFromRunToolsUsedBy } from '../../tool-policy';
import type { ReadinessCheck, ReadinessCheckResult, ReadinessContext } from '../types';

const SUGGESTION =
    'Remove it from tools.aliases and the steps. Skiller runs one skill at a time, so a run cannot start another.';

export class NotFromRunToolsCheck implements ReadinessCheck {
    readonly id = 'not-from-run-tools';
    readonly name = 'Not-From-Run Tools Check';

    check(skill: Skill, _context: ReadinessContext): ReadinessCheckResult {
        const issues = notFromRunToolsUsedBy(skill).map((name) => ({
            checkId: this.id,
            severity: 'error' as const,
            message: notFromRunToolMessage(name),
            suggestion: SUGGESTION,
        }));
        return { ready: issues.length === 0, issues };
    }
}
