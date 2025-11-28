/**
 * Skill - Claude Code reusable capability
 *
 * Skills are markdown files with YAML frontmatter
 * stored in .claude/skills/{skill-name}/SKILL.md
 */

export type SkillModel = 'inherit' | 'haiku' | 'sonnet' | 'opus';

export interface SkillMetadata {
    name: string;
    description: string;
    tools?: string;       // Comma-separated: "Read, Edit, Bash"
    model?: SkillModel;
}

export interface Skill {
    name: string;
    description: string;
    tools: string[];
    model: SkillModel;
    content: string;      // Markdown instructions
    filePath: string;     // Full path to SKILL.md
}

export function createSkill(
    name: string,
    description: string,
    content: string,
    tools: string[] = [],
    model: SkillModel = 'inherit'
): Omit<Skill, 'filePath'> {
    return {
        name: normalizeSkillName(name),
        description,
        tools,
        model,
        content
    };
}

export function normalizeSkillName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
}

export function skillToMarkdown(skill: Skill | Omit<Skill, 'filePath'>): string {
    const frontmatter = [
        '---',
        `name: ${skill.name}`,
        `description: ${skill.description}`,
        ...(skill.tools.length > 0 ? [`tools: ${skill.tools.join(', ')}`] : []),
        ...(skill.model !== 'inherit' ? [`model: ${skill.model}`] : []),
        '---',
        ''
    ].join('\n');

    return frontmatter + skill.content;
}

export function parseSkillMarkdown(content: string, filePath: string): Skill | null {
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

    const name = metadata['name'] || filePath.split('/').slice(-2, -1)[0] || '';

    return {
        name,
        description: metadata['description'] || '',
        tools: metadata['tools'] ? metadata['tools'].split(',').map(t => t.trim()) : [],
        model: (metadata['model'] as SkillModel) || 'inherit',
        content: body.trim(),
        filePath
    };
}
