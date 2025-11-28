/**
 * Command - Claude Code custom slash command
 *
 * Custom slash commands are markdown files with YAML frontmatter
 * stored in .claude/commands/
 */

export interface CommandMetadata {
    description: string;
    argumentHint?: string;
}

export interface Command {
    name: string;              // Command name without slash, e.g., "review-pr"
    description: string;
    argumentHint?: string;     // e.g., "<pr-number>"
    content: string;           // Markdown content
    filePath: string;          // Full path to the .md file
}

export function createCommand(
    name: string,
    description: string,
    content: string,
    argumentHint?: string
): Omit<Command, 'filePath'> {
    return {
        name: normalizeCommandName(name),
        description,
        argumentHint,
        content
    };
}

export function normalizeCommandName(name: string): string {
    // Remove leading slash if present
    if (name.startsWith('/')) {
        name = name.slice(1);
    }
    // Convert to lowercase kebab-case
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
}

export function commandToMarkdown(command: Command | Omit<Command, 'filePath'>): string {
    const frontmatter = [
        '---',
        `description: ${command.description}`,
        ...(command.argumentHint ? [`argument-hint: ${command.argumentHint}`] : []),
        '---',
        ''
    ].join('\n');

    return frontmatter + command.content;
}

export function parseCommandMarkdown(content: string, filePath: string): Command | null {
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

    const name = filePath.split('/').pop()?.replace('.md', '') || '';

    return {
        name,
        description: metadata['description'] || '',
        argumentHint: metadata['argument-hint'],
        content: body.trim(),
        filePath
    };
}
