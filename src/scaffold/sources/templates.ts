/**
 * Bundled skill templates. Pure: the template folders under `templates/<id>/`
 * are read by the caller (via an injected fs port), then rendered here.
 */
import type { SkillFiles } from '../types';

export interface TemplateEntry {
    id: 'basic' | 'approval' | 'loop' | 'tool' | 'editor';
    label: string;
    detail: string;
}

export const TEMPLATES: readonly TemplateEntry[] = [
    { id: 'basic', label: 'Basic', detail: 'One input, one LLM step, a summary' },
    { id: 'approval', label: 'With approval', detail: 'LLM step, a continue/abort confirmation, then another LLM step' },
    { id: 'loop', label: 'Loop', detail: 'A confirmation that jumps back (goto) to repeat a step' },
    { id: 'tool', label: 'Tool use', detail: 'An LLM step that calls a tool (skiller_createFile)' },
    { id: 'editor', label: 'Editor-native', detail: 'Reads your selection and replaces it with the result' },
];

const ID_PLACEHOLDER = '__SKILL_ID__';
const NAME_PLACEHOLDER = '__SKILL_NAME__';

/** Replace both identity placeholders in every file. */
export function renderTemplate(files: SkillFiles, identity: { id: string; name: string }): SkillFiles {
    const out = new Map<string, string>();
    for (const [p, content] of files) {
        out.set(p, content.split(ID_PLACEHOLDER).join(identity.id).split(NAME_PLACEHOLDER).join(identity.name));
    }
    return out;
}
