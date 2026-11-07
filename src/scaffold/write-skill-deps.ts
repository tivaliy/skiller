import type { RunController } from '../skills/run/controller';
import type { SkillRegistry } from '../skills/SkillRegistry';
import type { WriteSkillDeps } from '../tools/write-skill';
import { commitSkill } from './commit';
import { resolveTarget } from './target';
import { createVsCodeScaffoldFs } from './fs';
import { validateStagedSkill } from './validate-staged';

/**
 * Binds skiller_writeSkill to the live registry; target and taken ids are computed per commit.
 * `finish` (the editor's post-create steps) is injected so this core never imports the editor layer.
 */
export function createWriteSkillDeps(
    skillRegistry: SkillRegistry,
    finish: WriteSkillDeps['finish'],
    controller: Pick<RunController, 'active'>
): WriteSkillDeps {
    return {
        commit: (id, files) =>
            commitSkill(id, files, resolveTarget(skillRegistry), {
                fs: createVsCodeScaffoldFs(),
                validate: validateStagedSkill,
                takenIds: skillRegistry.getAll().map(s => s.id)
            }),
        // The tier comes from the commit result, never re-resolved here.
        finish,
        isSkillCreatorRun: () => {
            const skill = controller.active?.skill;
            return skill?.id === 'skill-creator' && skill.source.type === 'builtin';
        }
    };
}
