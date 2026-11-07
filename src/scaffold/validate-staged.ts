/** Boundary: validate a staged skill directory (parse + validate + readiness). */
import { parseSkill, validateSkill, checkReadiness } from '../skills';
import type { SkillSource } from '../skills/types';

export interface ValidateStagedOptions {
    /** Tier the skill is checked as; built-in-only tools are allowed only for 'builtin'. Default 'workspace'. */
    tier?: SkillSource['type'];
    /**
     * Run the readiness checks (tool availability, built-in-only tools). Default true.
     * Copies of shipped skills pass false: they are copied for editing, and the same
     * checks still run when the skill is started.
     */
    checkTools?: boolean;
}

export async function validateStagedSkill(dir: string, opts: ValidateStagedOptions = {}): Promise<string[]> {
    const { tier = 'workspace', checkTools = true } = opts;
    const parsed = await parseSkill(dir, { type: tier, path: dir });
    if (!parsed.success) {
        return [`skill.yaml: ${parsed.error.error}`];
    }
    const skill = parsed.skill;
    const lines: string[] = [];

    const validation = await validateSkill(skill, { validateStepFiles: true });
    for (const issue of validation.errors) {
        const where = issue.location?.file ?? issue.location?.field ?? 'skill.yaml';
        lines.push(`${where}: ${issue.message}`);
    }

    if (checkTools) {
        const readiness = checkReadiness(skill, {});
        for (const issue of readiness.errors) {
            lines.push(`tools: ${issue.message}`);
        }
    }
    return lines;
}
