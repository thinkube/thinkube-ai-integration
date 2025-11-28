/**
 * Agent - Claude Code subagent definition
 *
 * Agents are markdown files with YAML frontmatter
 * stored in .claude/agents/{agent-name}.md
 */

export type AgentModel = 'inherit' | 'haiku' | 'sonnet' | 'opus';

export interface AgentMetadata {
    name: string;
    description: string;
    tools?: string;       // Comma-separated: "Task, Skill, Read"
    model?: AgentModel;
}

export interface Agent {
    name: string;
    description: string;
    tools: string[];
    model: AgentModel;
    content: string;      // Markdown instructions
    filePath: string;     // Full path to the .md file
}

export function createAgent(
    name: string,
    description: string,
    content: string,
    tools: string[] = [],
    model: AgentModel = 'inherit'
): Omit<Agent, 'filePath'> {
    return {
        name: normalizeAgentName(name),
        description,
        tools,
        model,
        content
    };
}

export function normalizeAgentName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
}

export function agentToMarkdown(agent: Agent | Omit<Agent, 'filePath'>): string {
    const frontmatter = [
        '---',
        `name: ${agent.name}`,
        `description: ${agent.description}`,
        ...(agent.tools.length > 0 ? [`tools: ${agent.tools.join(', ')}`] : []),
        ...(agent.model !== 'inherit' ? [`model: ${agent.model}`] : []),
        '---',
        ''
    ].join('\n');

    return frontmatter + agent.content;
}

export function parseAgentMarkdown(content: string, filePath: string): Agent | null {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
        return null;
    }

    const [, frontmatter, body] = frontmatterMatch;
    const metadata: Record<string, string> = {};

    frontmatter.split('\n').forEach(line => {
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (match) {
            metadata[match[1].trim()] = match[2].trim();
        }
    });

    const name = metadata['name'] || filePath.split('/').pop()?.replace('.md', '') || '';

    return {
        name,
        description: metadata['description'] || '',
        tools: metadata['tools'] ? metadata['tools'].split(',').map(t => t.trim()) : [],
        model: (metadata['model'] as AgentModel) || 'inherit',
        content: body.trim(),
        filePath
    };
}
