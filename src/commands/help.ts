/**
 * /help Command Handler
 *
 * Shows available commands and MCP tool status.
 */

import { CommandContext, CommandResult } from './types';
import { formatToolStatus } from './presenters';

export async function handleHelp(ctx: CommandContext): Promise<CommandResult> {
    const { stream, toolCache } = ctx;

    const mcpStatus = formatToolStatus(toolCache);

    stream.markdown(`## Skiller

I run declarative workflows (skills) in chat. Each skill is a YAML playbook that
orchestrates your MCP tools with review and input steps.

**Commands:**
- \`/help\` - Show this help
- \`/tools\` - Show available MCP tools
- \`/models\` - Show available language models for skill configuration
- \`/reload\` - Reload tools and skills
- \`/skills\` - List available skills
- \`/skill <name> [params]\` - Run a skill
- \`/status\` - Show whether a skill is awaiting input or confirmation
- \`/cancel\` - Cancel the skill awaiting input or confirmation
- \`/reset\` - Clear all Skiller state

**Example:** \`@skiller /skill greeter\`

---

${mcpStatus}`);

    return {
        handled: true,
        metadata: { command: 'help' }
    };
}
