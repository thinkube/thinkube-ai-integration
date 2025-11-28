/**
 * ClaudeConfigService - Service for managing Claude Code configuration
 *
 * Handles reading and writing of:
 * - .claude/settings.json (hooks, permissions, MCP servers)
 * - .claude/commands/{name}.md (custom slash commands)
 * - .claude/skills/{name}/SKILL.md (skills)
 * - .claude/agents/{name}.md (subagents)
 * - CLAUDE.md (project instructions)
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import {
    ClaudeConfig,
    ClaudeSettings,
    Permissions,
    createDefaultConfig,
    createDefaultSettings
} from '../models/ClaudeConfig';
import { Hook, HookEvent, HookMatcher, createHook } from '../models/Hook';
import { Command, parseCommandMarkdown, commandToMarkdown } from '../models/Command';
import { Skill, parseSkillMarkdown, skillToMarkdown } from '../models/Skill';
import { Agent, parseAgentMarkdown, agentToMarkdown } from '../models/Agent';
import { McpServer, McpServerConfig } from '../models/McpServer';

export type ConfigScope = 'project' | 'global';

export class ClaudeConfigService {
    private _onConfigChanged = new vscode.EventEmitter<ClaudeConfig>();
    readonly onConfigChanged = this._onConfigChanged.event;

    constructor(private basePath: string) {}

    // ========== Configuration Loading ==========

    /**
     * Get the configuration for a specific scope
     */
    async getConfig(scope: ConfigScope, projectPath?: string): Promise<ClaudeConfig> {
        const basePath = scope === 'global'
            ? path.join(process.env.HOME || '', '.claude')
            : projectPath || this.getWorkspacePath();

        if (!basePath) {
            throw new Error('No workspace folder open');
        }

        return this.loadConfig(basePath);
    }

    /**
     * Load configuration from a base path
     */
    private async loadConfig(basePath: string): Promise<ClaudeConfig> {
        const config = createDefaultConfig(basePath);

        // Load settings.json
        if (fs.existsSync(config.settingsPath)) {
            try {
                const content = fs.readFileSync(config.settingsPath, 'utf8');
                config.settings = JSON.parse(content);
            } catch (error) {
                console.error('Error loading settings.json:', error);
            }
        }

        // Load CLAUDE.md
        if (config.claudeMdPath && fs.existsSync(config.claudeMdPath)) {
            try {
                config.claudeMdContent = fs.readFileSync(config.claudeMdPath, 'utf8');
            } catch (error) {
                console.error('Error loading CLAUDE.md:', error);
            }
        }

        return config;
    }

    /**
     * Save settings to settings.json
     */
    async saveSettings(settings: ClaudeSettings, projectPath?: string): Promise<void> {
        const basePath = projectPath || this.getWorkspacePath();
        if (!basePath) {
            throw new Error('No workspace folder open');
        }

        const claudeDir = path.join(basePath, '.claude');
        const settingsPath = path.join(claudeDir, 'settings.json');

        // Ensure .claude directory exists
        if (!fs.existsSync(claudeDir)) {
            fs.mkdirSync(claudeDir, { recursive: true });
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

        // Emit change event
        const config = await this.loadConfig(basePath);
        this._onConfigChanged.fire(config);
    }

    // ========== Hooks ==========

    /**
     * Get hooks from settings, optionally filtered by event type
     */
    async getHooks(eventFilter?: HookEvent, projectPath?: string): Promise<Hook[]> {
        const config = await this.getConfig('project', projectPath);
        const hooks: Hook[] = [];

        const processHooks = (event: HookEvent, matchers?: HookMatcher[]) => {
            if (!matchers) return;
            for (const matcher of matchers) {
                for (const hookDef of matcher.hooks) {
                    hooks.push({
                        id: `${event}-${matcher.matcher}-${hookDef.command}`,
                        event,
                        matcher: matcher.matcher,
                        command: hookDef.command,
                        timeout: hookDef.timeout
                    });
                }
            }
        };

        if (!eventFilter || eventFilter === 'PreToolUse') {
            processHooks('PreToolUse', config.settings.hooks?.PreToolUse);
        }
        if (!eventFilter || eventFilter === 'PostToolUse') {
            processHooks('PostToolUse', config.settings.hooks?.PostToolUse);
        }

        return hooks;
    }

    /**
     * Add a new hook
     */
    async addHook(
        event: HookEvent,
        hookDef: { matcher: string; command: string; timeout?: number },
        projectPath?: string
    ): Promise<Hook> {
        const config = await this.getConfig('project', projectPath);
        const newHook = createHook(event, hookDef.matcher, hookDef.command, hookDef.timeout);

        // Ensure hooks structure exists
        if (!config.settings.hooks) {
            config.settings.hooks = { PreToolUse: [], PostToolUse: [] };
        }
        if (!config.settings.hooks[event]) {
            config.settings.hooks[event] = [];
        }

        // Check if matcher already exists
        const existingMatcher = config.settings.hooks[event]!.find(
            m => m.matcher === hookDef.matcher
        );

        if (existingMatcher) {
            existingMatcher.hooks.push({
                type: 'command',
                command: hookDef.command,
                ...(hookDef.timeout && { timeout: hookDef.timeout })
            });
        } else {
            config.settings.hooks[event]!.push({
                matcher: hookDef.matcher,
                hooks: [{
                    type: 'command',
                    command: hookDef.command,
                    ...(hookDef.timeout && { timeout: hookDef.timeout })
                }]
            });
        }

        await this.saveSettings(config.settings, projectPath);
        return newHook;
    }

    /**
     * Delete a hook
     */
    async deleteHook(event: HookEvent, hookId: string, projectPath?: string): Promise<void> {
        const config = await this.getConfig('project', projectPath);
        const hooks = await this.getHooks(event, projectPath);
        const hookToDelete = hooks.find(h => h.id === hookId);

        if (!hookToDelete || !config.settings.hooks) return;

        const matchers = config.settings.hooks[event];
        if (!matchers) return;

        for (const matcher of matchers) {
            if (matcher.matcher === hookToDelete.matcher) {
                matcher.hooks = matcher.hooks.filter(h => h.command !== hookToDelete.command);
            }
        }

        // Remove empty matchers
        config.settings.hooks[event] = matchers.filter(m => m.hooks.length > 0);

        await this.saveSettings(config.settings, projectPath);
    }

    // ========== Permissions ==========

    /**
     * Get permissions from settings
     */
    async getPermissions(projectPath?: string): Promise<Permissions> {
        const config = await this.getConfig('project', projectPath);
        return config.settings.permissions || { allow: [], deny: [], ask: [] };
    }

    /**
     * Set permissions
     */
    async setPermissions(permissions: Permissions, projectPath?: string): Promise<void> {
        const config = await this.getConfig('project', projectPath);
        config.settings.permissions = permissions;
        await this.saveSettings(config.settings, projectPath);
    }

    /**
     * Add a permission rule
     */
    async addPermission(
        type: 'allow' | 'deny' | 'ask',
        rule: string,
        projectPath?: string
    ): Promise<void> {
        const config = await this.getConfig('project', projectPath);
        if (!config.settings.permissions) {
            config.settings.permissions = { allow: [], deny: [], ask: [] };
        }
        if (!config.settings.permissions[type].includes(rule)) {
            config.settings.permissions[type].push(rule);
        }
        await this.saveSettings(config.settings, projectPath);
    }

    /**
     * Remove a permission rule
     */
    async removePermission(
        type: 'allow' | 'deny' | 'ask',
        rule: string,
        projectPath?: string
    ): Promise<void> {
        const config = await this.getConfig('project', projectPath);
        if (config.settings.permissions) {
            config.settings.permissions[type] = config.settings.permissions[type].filter(
                r => r !== rule
            );
        }
        await this.saveSettings(config.settings, projectPath);
    }

    // ========== Commands ==========

    /**
     * Get all custom commands
     */
    async getCommands(projectPath?: string): Promise<Command[]> {
        const config = await this.getConfig('project', projectPath);
        const commands: Command[] = [];

        if (!fs.existsSync(config.commandsDir)) {
            return commands;
        }

        const files = fs.readdirSync(config.commandsDir);
        for (const file of files) {
            if (!file.endsWith('.md')) continue;

            const filePath = path.join(config.commandsDir, file);
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const command = parseCommandMarkdown(content, filePath);
                if (command) {
                    commands.push(command);
                }
            } catch (error) {
                console.error(`Error loading command ${file}:`, error);
            }
        }

        return commands;
    }

    /**
     * Create a new command
     */
    async createCommand(
        name: string,
        description: string,
        content: string,
        argumentHint?: string,
        projectPath?: string
    ): Promise<Command> {
        const config = await this.getConfig('project', projectPath);

        // Ensure commands directory exists
        if (!fs.existsSync(config.commandsDir)) {
            fs.mkdirSync(config.commandsDir, { recursive: true });
        }

        const command: Omit<Command, 'filePath'> = {
            name,
            description,
            content,
            argumentHint
        };

        const filePath = path.join(config.commandsDir, `${name}.md`);
        const fileContent = commandToMarkdown(command);

        fs.writeFileSync(filePath, fileContent);

        this._onConfigChanged.fire(config);

        return { ...command, filePath };
    }

    /**
     * Update an existing command
     */
    async updateCommand(name: string, updates: Partial<Command>, projectPath?: string): Promise<void> {
        const commands = await this.getCommands(projectPath);
        const existing = commands.find(c => c.name === name);

        if (!existing) {
            throw new Error(`Command ${name} not found`);
        }

        const updated: Command = { ...existing, ...updates };
        const content = commandToMarkdown(updated);

        fs.writeFileSync(existing.filePath, content);

        const config = await this.getConfig('project', projectPath);
        this._onConfigChanged.fire(config);
    }

    /**
     * Delete a command
     */
    async deleteCommand(name: string, projectPath?: string): Promise<void> {
        const commands = await this.getCommands(projectPath);
        const command = commands.find(c => c.name === name);

        if (command && fs.existsSync(command.filePath)) {
            fs.unlinkSync(command.filePath);

            const config = await this.getConfig('project', projectPath);
            this._onConfigChanged.fire(config);
        }
    }

    // ========== Skills ==========

    /**
     * Get all skills
     */
    async getSkills(projectPath?: string): Promise<Skill[]> {
        const config = await this.getConfig('project', projectPath);
        const skills: Skill[] = [];

        if (!fs.existsSync(config.skillsDir)) {
            return skills;
        }

        const dirs = fs.readdirSync(config.skillsDir, { withFileTypes: true });
        for (const dir of dirs) {
            if (!dir.isDirectory()) continue;

            const skillPath = path.join(config.skillsDir, dir.name, 'SKILL.md');
            if (!fs.existsSync(skillPath)) continue;

            try {
                const content = fs.readFileSync(skillPath, 'utf8');
                const skill = parseSkillMarkdown(content, skillPath);
                if (skill) {
                    skills.push(skill);
                }
            } catch (error) {
                console.error(`Error loading skill ${dir.name}:`, error);
            }
        }

        return skills;
    }

    /**
     * Create a new skill
     */
    async createSkill(
        name: string,
        description: string,
        content: string,
        tools: string[] = [],
        model: 'inherit' | 'haiku' | 'sonnet' | 'opus' = 'inherit',
        projectPath?: string
    ): Promise<Skill> {
        const config = await this.getConfig('project', projectPath);
        const skillDir = path.join(config.skillsDir, name);

        // Ensure skill directory exists
        if (!fs.existsSync(skillDir)) {
            fs.mkdirSync(skillDir, { recursive: true });
        }

        const skill: Omit<Skill, 'filePath'> = {
            name,
            description,
            content,
            tools,
            model
        };

        const filePath = path.join(skillDir, 'SKILL.md');
        const fileContent = skillToMarkdown(skill);

        fs.writeFileSync(filePath, fileContent);

        this._onConfigChanged.fire(config);

        return { ...skill, filePath };
    }

    /**
     * Delete a skill
     */
    async deleteSkill(name: string, projectPath?: string): Promise<void> {
        const skills = await this.getSkills(projectPath);
        const skill = skills.find(s => s.name === name);

        if (skill) {
            const skillDir = path.dirname(skill.filePath);
            if (fs.existsSync(skillDir)) {
                fs.rmSync(skillDir, { recursive: true });

                const config = await this.getConfig('project', projectPath);
                this._onConfigChanged.fire(config);
            }
        }
    }

    // ========== Agents ==========

    /**
     * Get all agents
     */
    async getAgents(projectPath?: string): Promise<Agent[]> {
        const config = await this.getConfig('project', projectPath);
        const agents: Agent[] = [];

        if (!fs.existsSync(config.agentsDir)) {
            return agents;
        }

        const files = fs.readdirSync(config.agentsDir);
        for (const file of files) {
            if (!file.endsWith('.md')) continue;

            const filePath = path.join(config.agentsDir, file);
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const agent = parseAgentMarkdown(content, filePath);
                if (agent) {
                    agents.push(agent);
                }
            } catch (error) {
                console.error(`Error loading agent ${file}:`, error);
            }
        }

        return agents;
    }

    /**
     * Create a new agent
     */
    async createAgent(
        name: string,
        description: string,
        content: string,
        tools: string[] = [],
        model: 'inherit' | 'haiku' | 'sonnet' | 'opus' = 'inherit',
        projectPath?: string
    ): Promise<Agent> {
        const config = await this.getConfig('project', projectPath);

        // Ensure agents directory exists
        if (!fs.existsSync(config.agentsDir)) {
            fs.mkdirSync(config.agentsDir, { recursive: true });
        }

        const agent: Omit<Agent, 'filePath'> = {
            name,
            description,
            content,
            tools,
            model
        };

        const filePath = path.join(config.agentsDir, `${name}.md`);
        const fileContent = agentToMarkdown(agent);

        fs.writeFileSync(filePath, fileContent);

        this._onConfigChanged.fire(config);

        return { ...agent, filePath };
    }

    /**
     * Delete an agent
     */
    async deleteAgent(name: string, projectPath?: string): Promise<void> {
        const agents = await this.getAgents(projectPath);
        const agent = agents.find(a => a.name === name);

        if (agent && fs.existsSync(agent.filePath)) {
            fs.unlinkSync(agent.filePath);

            const config = await this.getConfig('project', projectPath);
            this._onConfigChanged.fire(config);
        }
    }

    // ========== MCP Servers ==========

    /**
     * Get all MCP servers
     */
    async getMcpServers(projectPath?: string): Promise<McpServer[]> {
        const config = await this.getConfig('project', projectPath);
        const servers: McpServer[] = [];

        if (!config.settings.mcpServers) {
            return servers;
        }

        for (const [id, serverConfig] of Object.entries(config.settings.mcpServers)) {
            servers.push({
                id,
                name: id,
                config: serverConfig as McpServerConfig
            });
        }

        return servers;
    }

    /**
     * Add an MCP server
     */
    async addMcpServer(id: string, serverConfig: McpServerConfig, projectPath?: string): Promise<void> {
        const config = await this.getConfig('project', projectPath);

        if (!config.settings.mcpServers) {
            config.settings.mcpServers = {};
        }

        config.settings.mcpServers[id] = serverConfig;
        await this.saveSettings(config.settings, projectPath);
    }

    /**
     * Remove an MCP server
     */
    async removeMcpServer(id: string, projectPath?: string): Promise<void> {
        const config = await this.getConfig('project', projectPath);

        if (config.settings.mcpServers && config.settings.mcpServers[id]) {
            delete config.settings.mcpServers[id];
            await this.saveSettings(config.settings, projectPath);
        }
    }

    // ========== CLAUDE.md ==========

    /**
     * Get CLAUDE.md content
     */
    async getClaudeMd(projectPath?: string): Promise<string | undefined> {
        const config = await this.getConfig('project', projectPath);
        return config.claudeMdContent;
    }

    /**
     * Save CLAUDE.md content
     */
    async saveClaudeMd(content: string, projectPath?: string): Promise<void> {
        const basePath = projectPath || this.getWorkspacePath();
        if (!basePath) {
            throw new Error('No workspace folder open');
        }

        const claudeMdPath = path.join(basePath, 'CLAUDE.md');
        fs.writeFileSync(claudeMdPath, content);

        const config = await this.loadConfig(basePath);
        this._onConfigChanged.fire(config);
    }

    // ========== Utilities ==========

    /**
     * Get the workspace path
     */
    private getWorkspacePath(): string | undefined {
        return this.basePath;
    }

    /**
     * Check if .claude directory exists
     */
    async hasClaudeConfig(projectPath?: string): Promise<boolean> {
        const basePath = projectPath || this.getWorkspacePath();
        if (!basePath) return false;

        const claudeDir = path.join(basePath, '.claude');
        return fs.existsSync(claudeDir);
    }

    /**
     * Initialize .claude directory structure
     */
    async initializeClaudeConfig(projectPath?: string): Promise<void> {
        const basePath = projectPath || this.getWorkspacePath();
        if (!basePath) {
            throw new Error('No workspace folder open');
        }

        const config = createDefaultConfig(basePath);

        // Create directories
        const dirs = [
            path.dirname(config.settingsPath),
            config.commandsDir,
            config.skillsDir,
            config.agentsDir
        ];

        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        // Create default settings.json if it doesn't exist
        if (!fs.existsSync(config.settingsPath)) {
            fs.writeFileSync(
                config.settingsPath,
                JSON.stringify(createDefaultSettings(), null, 2)
            );
        }

        this._onConfigChanged.fire(config);
    }
}
