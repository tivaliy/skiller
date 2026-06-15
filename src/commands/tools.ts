/**
 * /tools Command Handler
 *
 * Shows available Language Model tools with optional category filtering.
 */

import { CommandContext, CommandResult } from './types';
import { summarizeToolCategories } from './presenters';

export async function handleTools(ctx: CommandContext): Promise<CommandResult> {
    const { request, stream, toolCache } = ctx;

    stream.progress('Discovering tools...');

    const status = toolCache.getStatus();
    const filter = request.prompt.trim().toLowerCase();

    if (!status.available) {
        stream.markdown(`## Tools

No tools available.

To enable tool invocation, configure MCP servers in \`.vscode/mcp.json\`.`);
    } else if (filter) {
        // Filter by category or name using toolCache
        const allTools = toolCache.getAllTools();
        const filteredTools = allTools.filter(t =>
            t.name.toLowerCase().includes(filter) ||
            t.category === filter
        );

        const toolList = filteredTools.map(t => `- \`${t.name}\``).join('\n');

        stream.markdown(`## Tools: "${filter}"

**Found ${filteredTools.length} tools:**

${toolList || 'No tools matching this filter.'}

**Tip:** Use exact tool name in skill definitions to enable orchestration.`);
    } else {
        // Build dynamic category table (shared sort/label/count logic)
        const tableRows = summarizeToolCategories(status)
            .map(({ category, displayName, count }) =>
                `| ${displayName} | ${count} | \`/tools ${category}\` |`)
            .join('\n');

        stream.markdown(`## Tools Available

**Summary:**
| Category | Count | Filter |
|----------|-------|--------|
${tableRows}

**Usage:** \`@skiller /tools jira\` to see Jira tools

**Note:** Tools are invoked programmatically - no tool schemas in context.`);
    }

    return {
        handled: true,
        metadata: { command: 'tools' }
    };
}
