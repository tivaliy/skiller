/**
 * Step Handlers Module
 *
 * Strategy pattern implementation for step execution.
 * Each step type has its own handler with single responsibility.
 *
 * ## Step Types and Handlers
 *
 * - `confirmation` → ConfirmationStepHandler (user checkpoints)
 * - `tool` → ToolStepHandler (pure MCP invocation, no LLM)
 * - `llm` / undefined → LLMStepHandler (agentic reasoning with optional tools)
 *
 * ## Usage
 *
 * ```typescript
 * import { createDefaultRegistry, stepContextFactory } from './handlers';
 * const registry = createDefaultRegistry();
 * const handler = registry.findHandler(step);
 * const ctx = stepContextFactory.create(...);
 * const result = await handler.handle(ctx, hooks);
 * ```
 */

// Type exports
export type {
    HandlerCategory,
    HandlerStepStatus,
    StepContext,
    ContextUpdates,
    HandlerResult,
    StepHandler,
    StepContextFactory
} from './types';

// Context factory
export { stepContextFactory } from './context';

// Handlers
export { ConfirmationStepHandler } from './confirmation';
export { ToolStepHandler } from './tool';
export { LLMStepHandler } from './llm';

// Utilities
export { buildHandlerResult, createErrorResult, handleMissingStepFile } from './utils';

// Registry
export { StepHandlerRegistry, createDefaultRegistry } from './registry';

// Runners (step execution implementations)
export {
    executeLLMStep,
    executeToolStep,
    tryParseJson,
    extractToolResultData,
    findMcpTool,
    withTimeout,
    isTimeoutError,
    TimeoutError,
    DEFAULT_TIMEOUTS
} from './runners';
