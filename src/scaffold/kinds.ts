/**
 * The ways to create a skill, in display order, for the `Skiller: New Skill…`
 * picker (command). Pure.
 */
export type NewSkillKind = 'describe' | 'template' | 'copy';

/** Command ids, shared by their registration (editor/scaffold-commands) and the callers that invoke them (editor/run). */
export const NEW_SKILL_COMMAND = 'skiller.newSkill';
export const COPY_SKILL_COMMAND = 'skiller.copySkill';

export interface NewSkillKindInfo {
    kind: NewSkillKind;
    label: string;
    description: string;
}

export const NEW_SKILL_KINDS: readonly NewSkillKindInfo[] = [
    { kind: 'describe', label: 'Describe it', description: 'Describe the workflow; Skiller drafts the skill' },
    { kind: 'template', label: 'From a template', description: 'Start from a ready-made skeleton' },
    { kind: 'copy', label: 'Copy a skill', description: 'Copy an example or built-in skill to edit' },
];
