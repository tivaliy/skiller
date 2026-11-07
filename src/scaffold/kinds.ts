/**
 * The ways to create a skill, in display order. Single source for the `/new` chat
 * menu (presenters) and the `Skiller: New Skill…` picker (command). Pure.
 */
export type NewSkillKind = 'describe' | 'template' | 'copy';

/** Command ids, shared by their registration (editor/scaffold-commands) and the chat links that invoke them (commands/presenters). */
export const NEW_SKILL_COMMAND = 'skiller.newSkill';
export const COPY_SKILL_COMMAND = 'skiller.copySkill';

export interface NewSkillKindInfo {
    kind: NewSkillKind;
    /** Monochrome glyph for the chat link row (⎘ matches the Copy action in /skills). */
    glyph: string;
    label: string;
    description: string;
}

export const NEW_SKILL_KINDS: readonly NewSkillKindInfo[] = [
    { kind: 'describe', glyph: '✎', label: 'Describe it', description: 'Describe the workflow; Skiller drafts the skill' },
    { kind: 'template', glyph: '▤', label: 'From a template', description: 'Start from a ready-made skeleton' },
    { kind: 'copy', glyph: '⎘', label: 'Copy a skill', description: 'Copy an example or built-in skill to edit' },
];
