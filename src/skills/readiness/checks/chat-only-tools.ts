/**
 * Chat-Only Tools Check
 *
 * Some tools need a VS Code chat session (Copilot's agent loop) and fail when a
 * Skiller run calls them. No Skiller run has one, whatever the skill's source, so
 * referencing one of these tools in skill.yaml is a readiness error for every skill.
 */

import type { Skill } from '../../types';
import { chatOnlyToolMessage, chatOnlyToolsUsedBy } from '../../tool-policy';
import type { ReadinessCheck, ReadinessCheckResult, ReadinessContext } from '../types';

export class ChatOnlyToolsCheck implements ReadinessCheck {
    readonly id = 'chat-only-tools';
    readonly name = 'Chat-Only Tools Check';

    check(skill: Skill, _context: ReadinessContext): ReadinessCheckResult {
        const issues = chatOnlyToolsUsedBy(skill).map((name) => ({
            checkId: this.id,
            severity: 'error' as const,
            message: chatOnlyToolMessage(name),
            suggestion: 'Remove it from tools.aliases and the steps. To write files, use skiller_createFile or skiller_replaceInFile.',
        }));
        return { ready: issues.length === 0, issues };
    }
}
