/**
 * Command Registry
 *
 * Manages slash command registration and dispatch.
 * Replaces module-singleton pattern with an injectable class.
 */

import { Command, CommandContext, CommandResult } from './types';

/**
 * Registry for slash commands.
 * Commands are registered at initialization and dispatched by name.
 */
export class CommandRegistry {
    private commands: Map<string, Command> = new Map();

    /**
     * Register a command
     */
    register(command: Command): void {
        this.commands.set(command.name, command);
    }

    /**
     * Register multiple commands at once
     */
    registerAll(commands: Command[]): void {
        for (const command of commands) {
            this.register(command);
        }
    }

    /**
     * Check if a command exists
     */
    has(name: string): boolean {
        return this.commands.has(name);
    }

    /**
     * Get a command by name
     */
    get(name: string): Command | undefined {
        return this.commands.get(name);
    }

    /**
     * Get all registered commands
     */
    getAll(): Command[] {
        return Array.from(this.commands.values());
    }

    /**
     * Get all command names
     */
    getNames(): string[] {
        return Array.from(this.commands.keys());
    }

    /**
     * Dispatch a command by name
     * Returns null if command not found (caller should handle)
     */
    async dispatch(
        commandName: string | undefined,
        ctx: CommandContext
    ): Promise<CommandResult | null> {
        if (!commandName) {
            return null;
        }

        const command = this.commands.get(commandName);
        if (!command) {
            return null;
        }

        // Uniform error boundary: a throwing command must not produce a dead/empty
        // chat turn or an unhandled rejection. Render the error and report handled.
        try {
            return await command.handler(ctx);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[Skiller] Command "/${commandName}" failed:`, error);
            ctx.stream.markdown(`\n❌ **\`/${commandName}\` failed**\n\n**Error:** ${message}\n`);
            return {
                handled: true,
                metadata: { command: commandName, error: 'command_failed', message }
            };
        }
    }

    /**
     * Get the number of registered commands
     */
    get size(): number {
        return this.commands.size;
    }
}
