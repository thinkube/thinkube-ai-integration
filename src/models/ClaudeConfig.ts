/**
 * ClaudeConfig - Main configuration structure for .claude/settings.json
 *
 * This represents the complete Claude Code configuration for a project.
 */

import { HookMatcher, HookEvent } from './Hook';
import { McpServerConfig } from './McpServer';

export interface Permissions {
    allow: string[];
    deny: string[];
    ask: string[];
}

export interface ClaudeSettings {
    hooks?: {
        PreToolUse?: HookMatcher[];
        PostToolUse?: HookMatcher[];
    };
    permissions?: Permissions;
    mcpServers?: Record<string, McpServerConfig>;
}

export interface ClaudeConfig {
    settings: ClaudeSettings;
    settingsPath: string;         // Path to settings.json
    claudeMdPath?: string;        // Path to CLAUDE.md
    claudeMdContent?: string;     // Content of CLAUDE.md
    commandsDir: string;          // Path to commands/
    skillsDir: string;            // Path to skills/
    agentsDir: string;            // Path to agents/
}

export function createDefaultSettings(): ClaudeSettings {
    return {
        hooks: {
            PreToolUse: [],
            PostToolUse: []
        },
        permissions: {
            allow: [],
            deny: [],
            ask: []
        },
        mcpServers: {}
    };
}

export function createDefaultConfig(basePath: string): ClaudeConfig {
    const claudeDir = `${basePath}/.claude`;
    return {
        settings: createDefaultSettings(),
        settingsPath: `${claudeDir}/settings.json`,
        claudeMdPath: `${basePath}/CLAUDE.md`,
        commandsDir: `${claudeDir}/commands`,
        skillsDir: `${claudeDir}/skills`,
        agentsDir: `${claudeDir}/agents`
    };
}

export function mergePermissions(base: Permissions, override: Partial<Permissions>): Permissions {
    return {
        allow: [...new Set([...base.allow, ...(override.allow || [])])],
        deny: [...new Set([...base.deny, ...(override.deny || [])])],
        ask: [...new Set([...base.ask, ...(override.ask || [])])]
    };
}
