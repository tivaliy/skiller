/**
 * Context matching
 *
 * A skill is offered as a contextual action when at least one of its
 * `from:`-bound inputs resolves to a non-empty value in the current snapshot.
 */

import type { Skill, EditorContextSnapshot } from '../skills';
import { resolveSource, hasValue, FILE_CONTENT_SOURCES } from '../skills';

export function skillMatchesContext(skill: Skill, snapshot: EditorContextSnapshot): boolean {
    return skill.inputs.some(input => {
        if (!input.from) return false;
        return hasValue(resolveSource(input.from, snapshot));
    });
}

/**
 * Whether any installed skill binds editor context via `from:`. Cheap (no editor
 * read): when false, the code-action provider can return immediately instead of
 * snapshotting the document — which copies the whole file — on every cursor move.
 */
export function anySkillBindsContext(skills: readonly Skill[]): boolean {
    return skills.some(skill => skill.inputs.some(input => !!input.from));
}

/**
 * Whether any installed skill binds the active file's full text (`activeFile` /
 * `activeFile.content`). Lets the code-action provider skip the costly full-file
 * `getText()` copy when only cheap sources (selection / path / language /
 * diagnostics) are bound — see FILE_CONTENT_SOURCES.
 */
export function anySkillBindsFileContent(skills: readonly Skill[]): boolean {
    return skills.some(skill =>
        skill.inputs.some(input => !!input.from && FILE_CONTENT_SOURCES.has(input.from)));
}
