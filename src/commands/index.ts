/**
 * Command Registry & Dispatcher
 *
 * Central registry for all slash commands.
 * Uses CommandRegistry class for command management.
 */

import { CommandRegistry } from './CommandRegistry';
import { handleHelp } from './help';
import { handleTools } from './tools';
import { handleModels } from './models';
import { handleReload } from './reload';
import { handleSkills } from './skills';
import { handleSkill } from './skill';
import { handleCancel, handleReset, handleStatus } from './control';

// Re-export confirmation and input collection handlers for extension.ts
export {
    handleConfirmationResponse,
    checkPendingConfirmation,
    handleInputResponse,
    checkPendingInputCollection
} from './skill';

// Re-export types for convenience
export { CommandContext, CommandResult, CommandHandler, Command } from './types';

// Re-export the class
export { CommandRegistry } from './CommandRegistry';

/**
 * Shared command registry instance
 * Used by extension.ts for command dispatch
 */
export const commandRegistry = new CommandRegistry();

// Register built-in commands
commandRegistry.register({
    name: 'help',
    description: 'Show available commands',
    handler: handleHelp
});

commandRegistry.register({
    name: 'tools',
    description: 'Show available MCP tools',
    handler: handleTools
});

commandRegistry.register({
    name: 'models',
    description: 'Show available language models for skill configuration',
    handler: handleModels
});

commandRegistry.register({
    name: 'reload',
    description: 'Reload tools and skills',
    handler: handleReload
});

commandRegistry.register({
    name: 'skills',
    description: 'List available skills',
    handler: handleSkills
});

commandRegistry.register({
    name: 'skill',
    description: 'Run a skill',
    handler: handleSkill
});

// Control commands — dispatched even while a skill is awaiting input/confirmation
commandRegistry.register({
    name: 'cancel',
    description: 'Cancel the skill awaiting input or confirmation',
    handler: handleCancel
});

commandRegistry.register({
    name: 'reset',
    description: 'Clear all Skiller state (pending interactions and highlights)',
    handler: handleReset
});

commandRegistry.register({
    name: 'status',
    description: 'Show whether a skill is awaiting input or confirmation',
    handler: handleStatus
});
