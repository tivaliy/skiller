/**
 * /models Command Handler
 *
 * Shows available language models for skill configuration.
 * Helps skill authors discover model IDs for the `model:` field.
 */

import * as vscode from 'vscode';
import { CommandContext, CommandResult } from './types';

/**
 * Group models by vendor for organized display
 */
interface VendorGroup {
    vendor: string;
    models: vscode.LanguageModelChat[];
}

/**
 * Format token count for display (e.g., 128000 -> "128K")
 */
function formatTokens(tokens: number | undefined): string {
    if (!tokens) return '-';
    if (tokens >= 1000) {
        return `${Math.round(tokens / 1000)}K`;
    }
    return String(tokens);
}

/**
 * Handle the /models command
 *
 * Lists all available language models grouped by vendor.
 * Shows model ID (for skill.yaml), family, and token limits.
 */
export async function handleModels(ctx: CommandContext): Promise<CommandResult> {
    const { stream } = ctx;

    stream.progress('Discovering available models...');

    try {
        const models = await vscode.lm.selectChatModels();

        if (models.length === 0) {
            stream.markdown(`## Language Models

No language models available.

Check your VS Code extensions to ensure language model providers are installed.`);
            return { handled: true, metadata: { command: 'models' } };
        }

        // Group models by vendor
        const vendorGroups = groupByVendor(models);

        // Build output
        let output = `## Language Models (${models.length})\n\n`;
        output += `Use these model IDs in your \`skill.yaml\` files.\n\n`;

        for (const group of vendorGroups) {
            output += `### ${capitalizeVendor(group.vendor)}\n\n`;
            output += `| Model ID | Family | Max Tokens |\n`;
            output += `|----------|--------|------------|\n`;

            for (const model of group.models) {
                const family = model.family || '-';
                const maxTokens = formatTokens(model.maxInputTokens);
                output += `| \`${model.id}\` | ${family} | ${maxTokens} |\n`;
            }

            output += `\n`;
        }

        // Usage example
        output += `### Usage in skill.yaml\n\n`;
        output += `\`\`\`yaml
models:
  default: gpt-4o
  aliases:
    fast: gpt-4o-mini
    smart: gpt-4o

steps:
  - id: classify
    model: fast          # Use alias
    file: steps/classify.md

  - id: analyze
    model: gpt-4o        # Or use direct ID
    file: steps/analyze.md
\`\`\`\n`;

        stream.markdown(output);

        return {
            handled: true,
            metadata: { command: 'models', modelCount: models.length }
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        stream.markdown(`## Language Models

**Error:** Failed to discover models: ${errorMessage}`);

        return {
            handled: true,
            metadata: { command: 'models', error: errorMessage }
        };
    }
}

/**
 * Group models by vendor
 */
function groupByVendor(models: vscode.LanguageModelChat[]): VendorGroup[] {
    const groups = new Map<string, vscode.LanguageModelChat[]>();

    for (const model of models) {
        const vendor = model.vendor || 'unknown';
        const existing = groups.get(vendor) || [];
        existing.push(model);
        groups.set(vendor, existing);
    }

    // Sort groups by vendor name, models by ID within each group
    return Array.from(groups.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([vendor, vendorModels]) => ({
            vendor,
            models: vendorModels.sort((a, b) => a.id.localeCompare(b.id))
        }));
}

/**
 * Capitalize vendor name for display
 */
function capitalizeVendor(vendor: string): string {
    if (!vendor) return 'Unknown';
    return vendor.charAt(0).toUpperCase() + vendor.slice(1);
}
