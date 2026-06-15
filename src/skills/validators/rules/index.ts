/**
 * Validation Rules Index
 *
 * Exports all validators organized by phase.
 */

// Schema phase validators
export {
    schemaValidators,
    StepIdValidator,
    InputDefinitionValidator,
    ToolConfigurationValidator,
    ModelConfigurationValidator,
    ConfirmationOptionsValidator,
    OutputVariablesValidator,
    StepFilesValidator
} from './schema';

// Semantic phase validators
export {
    semanticValidators,
    CircularReferencesValidator,
    RequiresOrderingValidator,
    UnreachableStepsValidator,
    ConfirmationPathsValidator,
    ExecutionFlowValidator
} from './semantic';

// Template phase validators
export {
    templateValidators,
    VariableExistenceValidator,
    OutputOrderingValidator,
    ConditionSyntaxValidator,
    ParamsInterpolationValidator
} from './template';

// Security phase validators
export {
    securityValidators,
    PathTraversalValidator,
    IdCharactersValidator,
    InputConstraintsValidator,
    ToolParamsPathValidator
} from './security';

// Combined export of all validators
import { schemaValidators } from './schema';
import { semanticValidators } from './semantic';
import { templateValidators } from './template';
import { securityValidators } from './security';

/**
 * All validators as a flat array
 * Order matches VALIDATION_PHASES: schema → semantic → template → security
 */
export const allValidators = [
    ...schemaValidators,
    ...semanticValidators,
    ...templateValidators,
    ...securityValidators
];
