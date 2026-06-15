/**
 * Step Handler Registry
 *
 * Manages registration and lookup of step handlers.
 * Provides Open/Closed extensibility - add handlers without modifying executor.
 *
 * Single Responsibility: Knows which handler handles which step category.
 */

import type { SkillStep, StepType } from '../types';
import type { StepHandler, HandlerCategory } from './types';
import type { ToolResolver } from '../tool-resolver';
import { ConfirmationStepHandler } from './confirmation';
import { ToolStepHandler } from './tool';
import { LLMStepHandler } from './llm';

/**
 * Registry for step handlers
 *
 * Handlers are checked in order - first match wins.
 * LLMStepHandler (default for undefined type) should be registered last.
 */
export class StepHandlerRegistry {
    private handlers: StepHandler[] = [];

    /**
     * Register a handler
     *
     * Handlers are checked in registration order.
     * Register more specific handlers before generic ones.
     *
     * @param handler - Handler to register
     */
    register(handler: StepHandler): void {
        this.handlers.push(handler);
    }

    /**
     * Register a handler at the beginning (highest priority)
     *
     * @param handler - Handler to register
     */
    registerFirst(handler: StepHandler): void {
        this.handlers.unshift(handler);
    }

    /**
     * Find handler for a step
     *
     * @param step - Step to find handler for
     * @returns Handler that can process the step, or undefined
     */
    findHandler(step: SkillStep): StepHandler | undefined {
        for (const handler of this.handlers) {
            if (handler.canHandle(step)) {
                return handler;
            }
        }
        return undefined;
    }

    /**
     * Get all registered handlers
     */
    getHandlers(): readonly StepHandler[] {
        return this.handlers;
    }

    /**
     * Check if a handler category is registered
     *
     * @param category - The handler category to check
     * @returns true if a handler with this category is registered
     */
    hasHandlerCategory(category: HandlerCategory): boolean {
        return this.handlers.some(h => h.category === category);
    }

    /**
     * Check if a handler exists that can process a specific StepType
     *
     * @param stepType - The step type from skill.yaml
     * @returns true if a handler declares it can handle this step type
     */
    hasHandlerForStepType(stepType: StepType): boolean {
        return this.handlers.some(h => h.handledStepTypes.includes(stepType));
    }

    /**
     * Get all StepTypes that have registered handlers
     */
    getHandledStepTypes(): readonly StepType[] {
        const types = new Set<StepType>();
        for (const handler of this.handlers) {
            for (const type of handler.handledStepTypes) {
                types.add(type);
            }
        }
        return Array.from(types);
    }
}

/**
 * Create a registry with default handlers
 *
 * Order matters - more specific handlers first:
 * 1. ConfirmationStepHandler - handles 'confirmation' steps
 * 2. ToolStepHandler - handles 'tool' steps (pure MCP invocation)
 * 3. LLMStepHandler - handles 'llm' steps and undefined (default/fallback)
 *
 * Creates a fresh registry each time - no shared state.
 * For testing, create a custom registry with mock handlers.
 *
 * @param toolResolver - Optional tool resolver for LLM handler dependency injection
 */
export function createDefaultRegistry(toolResolver?: ToolResolver): StepHandlerRegistry {
    const registry = new StepHandlerRegistry();

    // Register in order of specificity (most specific first).
    // Both tool and LLM handlers share the same resolver (when provided).
    registry.register(new ConfirmationStepHandler());
    registry.register(toolResolver ? new ToolStepHandler(toolResolver) : new ToolStepHandler());
    registry.register(new LLMStepHandler(toolResolver));

    return registry;
}
