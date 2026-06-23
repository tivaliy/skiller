/**
 * Skills Module
 *
 * Pluggable workflow system for multi-step LLM interactions.
 * Skills are defined declaratively in YAML + Markdown and can be:
 * - Built-in: Bundled with the extension
 * - User-level: In ~/.vscode/skiller/skills/
 * - Workspace: In .skiller/skills/ directory
 *
 * Priority: Workspace > User > Built-in (workspace can override built-in)
 */

// Core domain types from types.ts
export type {
    Skill,
    SkillInput,
    SkillStep,
    SkillTools,
    SkillSource,
    SkillOutput,
    ErrorStrategy,
    ExecutionContext,
    StepResult,
    SkillResult,
    DiscoveredSkills,
    StepType,
    ConfirmationAction,
    InputType,
    ConfirmationOption,
    ConfirmationResponse,
    PendingConfirmationInfo,
    PendingConfirmation,
    PendingInputCollection,
    ExecutionOptions,
    ResumeOptions,
    VerboseMode,
    ParsedStep,
    StepMeta,
    ParseError,
    ParseSkillResult,
    ParsedToolAlias,
    ToolReference
} from './types';

// Validation types from validators module
export type {
    ValidationIssue,
    ValidationResult,
    ValidationPhase,
    ValidationOptions,
    InputValidationResult,
    SingleInputValidationResult
} from './validators';

// Progress hooks from progress-hooks module
export type { ProgressHooks } from './progress-hooks';

// Execution state types (single source of truth)
export type {
    StepStatus,
    TerminalStatus,
    StepInspection,
    StepInspectionKind,
    ExecutionState,
    ExecutionEvent,
    ExecutionEventListener,
    ExecutionStateManager
} from './execution-state';

// Constants exports
export {
    INPUT_TYPES,
    STEP_TYPES,
    CONFIRMATION_ACTIONS,
    ERROR_STRATEGIES,
    VERBOSE_MODES
} from './types';

// Parser exports
export {
    parseSkill,
    loadSkillSteps,
    parseAliasValue
} from './parser';

// Schema validator exports - validates skill YAML definitions
export {
    validateSkill,
    formatValidationResult
} from './validators';

// Interpolation exports
export {
    interpolate,
    evaluateCondition
} from './interpolation';

// Registry - class-based API
export { SkillRegistry } from './SkillRegistry';
export type { SkillRefreshResult } from './SkillRegistry';

// Executor exports - factory function preferred, class for testing
export { SkillExecutor, createSkillExecutor } from './SkillExecutor';

// Tool resolver for MCP tool lookup
export { VSCodeToolResolver, createToolResolver, ToolResolutionError } from './tool-resolver';
export type { ToolResolver, ToolValidationResult, MissingToolInfo, ResolvedToolInfo } from './tool-resolver';

// Execution readiness - pre-flight checks before skill execution
export { checkReadiness } from './readiness';

export type {
    ExecutionReadiness,
    ReadinessIssue
} from './readiness';

// Extensibility: for creating custom readiness checks
export { createReadinessEngine, ReadinessEngine } from './readiness';
export type { ReadinessCheck, ReadinessContext } from './readiness';

// Input validation exports - validates runtime input values
export {
    validateInputs,
    validateSingleInput,
    applyDefaults,
    parseConfirmationResponse,
    parseBoolean
} from './validators';

// Progress hooks factory
export { createStreamProgressHooks } from './progress-hooks';

// Shared helpers
export { hasValue } from './utils';

// Pending state management - class for dependency injection
export { PendingStateManager } from './PendingStateManager';

// Launch-context hand-off - session state bridging an editor trigger to the
// /skill handler + output sink (same kind of CommandContext collaborator as
// PendingStateManager; vscode-free, lives here so the command layer depends on
// it through the shared engine rather than reaching into the editor layer).
export { LaunchContextStore } from './launch-context-store';

// Execution state management - DI-friendly with factory
export {
    ExecutionStateEmitter,
    createExecutionState
} from './execution-state';

// Graph visualization exports
export {
    showSkillGraph,
    buildSkillGraph,
    SkillGraphBuilder,
    enableLiveReload,
    refreshOpenPanels,
    panelManager,
    StepInspectionDocumentProvider
} from './graph';

// Step inspector (read-only prompt/response document)
export { STEP_INSPECTION_SCHEME } from './step-inspection';

export { registerSkillCodeLens } from './graph/codelens-provider';

export type {
    SkillGraph,
    GraphNode,
    GraphEdge,
    RenderOptions
} from './graph';

// Editor-context resolution - bind skill inputs to selection/file/diff/diagnostics
export * from './context';

// Editor output sinks - deliver a completed skill's summary to editor/file/diff
export * from './output';
