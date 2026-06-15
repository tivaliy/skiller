/**
 * Presenter layer for /skill command.
 * Centralizes all stream.markdown() calls for consistent UI formatting.
 */

import * as vscode from 'vscode';
import { SkillInput, ConfirmationOption, ExecutionReadiness, ReadinessIssue } from '../../skills';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format a value for display in the UI
 */
export function formatValue(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.join(', ');
    }
    return JSON.stringify(value);
}

// ============================================================================
// Input Collection UI
// ============================================================================

/**
 * Show prompt for a specific input
 */
export function showInputPrompt(stream: vscode.ChatResponseStream, input: SkillInput): void {
    const promptText = input.prompt || `Please provide **${input.name}** (${input.type}):`;
    stream.markdown(`${promptText}\n\n`);

    // Show description as hint (only if no custom prompt)
    if (input.description && !input.prompt) {
        stream.markdown(`_${input.description}_\n\n`);
    }

    // Show enum options as numbered list
    if (input.enum && input.enum.length > 0) {
        stream.markdown(`**Options:**\n`);
        input.enum.forEach((option, index) => {
            const isDefault = input.default === option;
            const marker = isDefault ? ' ← default' : '';
            stream.markdown(`  ${index + 1}. ${option}${marker}\n`);
        });
        stream.markdown(`\n`);
    }

    // Show default/optional hints
    if (input.default !== undefined) {
        const defaultDisplay = formatValue(input.default);
        stream.markdown(`_Press **Enter** to use default: \`${defaultDisplay}\`_\n`);
    } else if (!input.required) {
        stream.markdown(`_Press **Enter** to skip (optional)_\n`);
    }
}

/**
 * Show confirmation that default value is being used
 */
export function showUsingDefault(stream: vscode.ChatResponseStream, value: unknown): void {
    stream.markdown(`✓ Using default: \`${formatValue(value)}\`\n\n`);
}

/**
 * Show confirmation that input was skipped
 */
export function showSkipped(stream: vscode.ChatResponseStream): void {
    stream.markdown(`✓ Skipped (optional)\n\n`);
}

/**
 * Show confirmation that input was received
 */
export function showGotIt(stream: vscode.ChatResponseStream): void {
    stream.markdown(`✓ Got it!\n\n`);
}

/**
 * Show confirmation that all inputs are collected
 */
export function showAllInputsCollected(stream: vscode.ChatResponseStream): void {
    stream.markdown(`✓ All inputs collected!\n\n`);
    stream.markdown(`---\n\n`);
}

// ============================================================================
// Error Messages
// ============================================================================

/**
 * Show error for missing required input
 */
export function showRequiredInputError(stream: vscode.ChatResponseStream, inputName: string): void {
    stream.markdown(`⚠️ **Required input**\n\n`);
    stream.markdown(`"${inputName}" is required and cannot be empty.\n\n`);
}

/**
 * Show error for invalid enum selection
 */
export function showInvalidEnumError(stream: vscode.ChatResponseStream, enumLength: number): void {
    stream.markdown(`⚠️ **Invalid selection**\n\n`);
    stream.markdown(`Please enter a number (1-${enumLength}) or exact value.\n\n`);
}

/**
 * Show error for invalid format (pattern mismatch)
 */
export function showInvalidFormatError(stream: vscode.ChatResponseStream): void {
    stream.markdown(`⚠️ **Invalid format**\n\n`);
    stream.markdown(`The value doesn't match the expected pattern.\n\n`);
}

/**
 * Show skill execution error
 */
export function showExecutionError(stream: vscode.ChatResponseStream, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    stream.markdown(`\n**Skill execution failed:** ${message}\n`);
}

/**
 * Show validation errors list
 */
export function showValidationErrors(stream: vscode.ChatResponseStream, errors: string[]): void {
    stream.markdown(`**Validation errors:**\n\n`);
    for (const error of errors) {
        stream.markdown(`- ${error}\n`);
    }
}

/**
 * Show invalid inputs errors
 */
export function showInvalidInputs(stream: vscode.ChatResponseStream, errors: string[]): void {
    stream.markdown(`**Invalid inputs:**\n\n`);
    for (const error of errors) {
        stream.markdown(`- ${error}\n`);
    }
}

// ============================================================================
// Skill Status
// ============================================================================

/**
 * Show skill starting message
 */
export function showSkillStarting(stream: vscode.ChatResponseStream, skillName: string): void {
    stream.markdown(`**Starting skill:** ${skillName}\n\n`);
}

/**
 * Show skill cancelled message
 */
export function showSkillCancelled(
    stream: vscode.ChatResponseStream,
    skillId: string,
    context: 'input' | 'confirmation',
    stepId?: string
): void {
    stream.markdown(`❌ **Skill Cancelled**\n\n`);
    if (context === 'input') {
        stream.markdown(`Skill "${skillId}" was cancelled during input collection.\n`);
    } else {
        stream.markdown(`Skill "${skillId}" was cancelled at step "${stepId}".\n`);
    }
}

/**
 * Show skill not found message
 */
export function showSkillNotFound(stream: vscode.ChatResponseStream, skillId: string): void {
    stream.markdown(`**Skill not found:** \`${skillId}\`\n\n`);
    stream.markdown('Use `/skills` to see available skills.\n');
}

/**
 * Show execution readiness errors (blocks execution)
 */
export function showReadinessErrors(
    stream: vscode.ChatResponseStream,
    skillId: string,
    readiness: ExecutionReadiness
): void {
    stream.markdown(`❌ **Cannot run skill "${skillId}"**\n\n`);

    for (const error of readiness.errors) {
        stream.markdown(`• ${error.message}\n`);
        if (error.suggestion) {
            stream.markdown(`  💡 ${error.suggestion}\n`);
        }
    }

    stream.markdown(`\n`);
}

/**
 * Show execution readiness warnings (doesn't block execution)
 */
export function showReadinessWarnings(
    stream: vscode.ChatResponseStream,
    warnings: ReadinessIssue[]
): void {
    stream.markdown(`⚠️ **Warnings:**\n\n`);
    for (const warning of warnings) {
        stream.markdown(`• ${warning.message}\n`);
    }
    stream.markdown(`\n`);
}

/**
 * Show skill validation failed
 */
export function showSkillValidationFailed(
    stream: vscode.ChatResponseStream,
    formattedResult: string
): void {
    stream.markdown(`**Cannot run skill:** Validation failed\n\n`);
    stream.markdown(formattedResult);
}

/**
 * Show usage help
 */
export function showUsage(stream: vscode.ChatResponseStream): void {
    stream.markdown('**Usage:** `/skill <name> [params]`\n\n');
    stream.markdown('Use `/skills` to see available skills.\n');
}

// ============================================================================
// Confirmation UI
// ============================================================================

/**
 * Show confirmation options
 */
export function showConfirmationOptions(
    stream: vscode.ChatResponseStream,
    options: ConfirmationOption[]
): void {
    stream.markdown(`**Select an option** (reply with number):\n\n`);
    options.forEach((opt, idx) => {
        stream.markdown(`**${idx + 1}.** ${opt.label}\n`);
    });
    stream.markdown(`\n_Type \`cancel\` to abort._\n`);
}

/**
 * Show invalid confirmation response
 */
export function showInvalidConfirmationResponse(
    stream: vscode.ChatResponseStream,
    skillId: string,
    options: ConfirmationOption[]
): void {
    stream.markdown(`⚠️ **Invalid response** for skill "${skillId}"\n\n`);
    stream.markdown(`Please reply with a number (1-${options.length}):\n\n`);
    options.forEach((opt, idx) => {
        stream.markdown(`**${idx + 1}.** ${opt.label}\n`);
    });
    stream.markdown('\n_Type `cancel` to abort._\n');
}

/**
 * Show resuming skill message
 */
export function showResuming(stream: vscode.ChatResponseStream, skillId: string): void {
    stream.markdown(`---\n\n`);
    stream.markdown(`▶️ **Resuming skill:** ${skillId}\n\n`);
}

/**
 * Show selected option
 */
export function showSelectedOption(
    stream: vscode.ChatResponseStream,
    label: string,
    gotoStep?: string
): void {
    stream.markdown(`Selected: **${label}**\n`);
    if (gotoStep) {
        stream.markdown(`Jumping to step: \`${gotoStep}\`\n\n`);
    } else {
        stream.markdown(`\n`);
    }
}

/**
 * Show step not found warning
 */
export function showStepNotFound(stream: vscode.ChatResponseStream, stepId: string): void {
    stream.markdown(`⚠️ Step "${stepId}" not found. Continuing from next step.\n\n`);
}

// ============================================================================
// Pending State UI
// ============================================================================

/**
 * Show pending confirmation state
 */
export function showPendingConfirmation(
    stream: vscode.ChatResponseStream,
    skillId: string,
    stepId: string,
    options: ConfirmationOption[]
): void {
    stream.markdown(`⚠️ **Pending Confirmation**\n\n`);
    stream.markdown(`Skill "${skillId}" is waiting for your response at step \`${stepId}\`.\n\n`);
    showConfirmationOptions(stream, options);
}

/**
 * Show pending input collection state
 */
export function showPendingInput(
    stream: vscode.ChatResponseStream,
    skillId: string,
    input: SkillInput
): void {
    stream.markdown(`⏸️ **Waiting for input**\n\n`);
    stream.markdown(`Skill "${skillId}" is waiting for your input.\n\n`);
    showInputPrompt(stream, input);
    stream.markdown(`\n_Type \`cancel\` to abort._\n`);
}
