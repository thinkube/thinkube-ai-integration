/**
 * ConfigTreeProvider - TreeDataProvider for Claude Code Configuration sidebar
 *
 * Displays a tree view of:
 * - Hooks (PreToolUse, PostToolUse)
 * - Commands (slash commands)
 * - Skills
 * - Agents
 * - MCP Servers
 * - Permissions
 */

import * as vscode from 'vscode';
import { ClaudeConfigService } from '../../services/ClaudeConfigService';
import { Hook } from '../../models/Hook';
import { Command } from '../../models/Command';
import { Skill } from '../../models/Skill';
import { Agent } from '../../models/Agent';
import { McpServer } from '../../models/McpServer';

export type ConfigItemType =
    | 'root'
    | 'hooks-section'
    | 'commands-section'
    | 'skills-section'
    | 'agents-section'
    | 'mcp-section'
    | 'permissions-section'
    | 'hook-event'
    | 'hook'
    | 'command'
    | 'skill'
    | 'agent'
    | 'mcp-server'
    | 'permission-allow'
    | 'permission-deny'
    | 'permission-ask'
    | 'permission-item';

export class ConfigTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly itemType: ConfigItemType,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly data?: Hook | Command | Skill | Agent | McpServer | string,
        public readonly parentType?: ConfigItemType
    ) {
        super(label, collapsibleState);
        this.contextValue = itemType;
        this.setIconAndTooltip();
    }

    private setIconAndTooltip(): void {
        switch (this.itemType) {
            case 'hooks-section':
                this.iconPath = new vscode.ThemeIcon('zap');
                this.tooltip = 'Event hooks for tool execution';
                break;
            case 'commands-section':
                this.iconPath = new vscode.ThemeIcon('terminal');
                this.tooltip = 'Custom slash commands';
                break;
            case 'skills-section':
                this.iconPath = new vscode.ThemeIcon('lightbulb');
                this.tooltip = 'Reusable capabilities';
                break;
            case 'agents-section':
                this.iconPath = new vscode.ThemeIcon('person');
                this.tooltip = 'Subagent definitions';
                break;
            case 'mcp-section':
                this.iconPath = new vscode.ThemeIcon('plug');
                this.tooltip = 'MCP Server configurations';
                break;
            case 'permissions-section':
                this.iconPath = new vscode.ThemeIcon('shield');
                this.tooltip = 'Tool permissions';
                break;
            case 'hook-event':
                this.iconPath = new vscode.ThemeIcon('symbol-event');
                break;
            case 'hook':
                this.iconPath = new vscode.ThemeIcon('symbol-function');
                if (this.data) {
                    const hook = this.data as Hook;
                    this.tooltip = `Matcher: ${hook.matcher}\nCommand: ${hook.command}`;
                }
                break;
            case 'command':
                this.iconPath = new vscode.ThemeIcon('symbol-method');
                if (this.data) {
                    const cmd = this.data as Command;
                    this.tooltip = cmd.description || 'No description';
                    this.command = {
                        command: 'thinkube.openCommand',
                        title: 'Open Command',
                        arguments: [cmd]
                    };
                }
                break;
            case 'skill':
                this.iconPath = new vscode.ThemeIcon('symbol-class');
                if (this.data) {
                    const skill = this.data as Skill;
                    this.tooltip = skill.description || 'No description';
                    this.command = {
                        command: 'thinkube.openSkill',
                        title: 'Open Skill',
                        arguments: [skill]
                    };
                }
                break;
            case 'agent':
                this.iconPath = new vscode.ThemeIcon('hubot');
                if (this.data) {
                    const agent = this.data as Agent;
                    this.tooltip = agent.description || 'No description';
                    this.command = {
                        command: 'thinkube.openAgent',
                        title: 'Open Agent',
                        arguments: [agent]
                    };
                }
                break;
            case 'mcp-server':
                if (this.data) {
                    const server = this.data as McpServer;
                    this.iconPath = new vscode.ThemeIcon(
                        server.status === 'running' ? 'circle-filled' :
                        server.status === 'error' ? 'error' : 'circle-outline'
                    );
                    this.tooltip = `Command: ${server.config.command}\nStatus: ${server.status || 'unknown'}`;
                } else {
                    this.iconPath = new vscode.ThemeIcon('circle-outline');
                }
                break;
            case 'permission-allow':
                this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
                this.tooltip = 'Allowed tools/commands';
                break;
            case 'permission-deny':
                this.iconPath = new vscode.ThemeIcon('x', new vscode.ThemeColor('charts.red'));
                this.tooltip = 'Denied tools/commands';
                break;
            case 'permission-ask':
                this.iconPath = new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.yellow'));
                this.tooltip = 'Tools requiring confirmation';
                break;
            case 'permission-item':
                this.iconPath = new vscode.ThemeIcon('symbol-string');
                break;
        }
    }
}

export class ConfigTreeProvider implements vscode.TreeDataProvider<ConfigTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ConfigTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private configService: ClaudeConfigService) {
        // Refresh tree when config changes
        configService.onConfigChanged(() => {
            this.refresh();
        });
    }

    /**
     * Update the config service (used when switching workspace context)
     */
    setConfigService(newService: ClaudeConfigService): void {
        this.configService = newService;

        // Re-subscribe to config changes
        newService.onConfigChanged(() => {
            this.refresh();
        });

        // Refresh tree to show new context
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConfigTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ConfigTreeItem): Promise<ConfigTreeItem[]> {
        if (!element) {
            // Root level - show main sections (or empty for welcome view)
            return this.getRootChildren();
        }

        switch (element.itemType) {
            case 'hooks-section':
                return this.getHooksChildren();
            case 'hook-event':
                return this.getHookEventChildren(element.label as 'PreToolUse' | 'PostToolUse');
            case 'commands-section':
                return this.getCommandsChildren();
            case 'skills-section':
                return this.getSkillsChildren();
            case 'agents-section':
                return this.getAgentsChildren();
            case 'mcp-section':
                return this.getMcpChildren();
            case 'permissions-section':
                return this.getPermissionsChildren();
            case 'permission-allow':
            case 'permission-deny':
            case 'permission-ask':
                return this.getPermissionItemsChildren(element.itemType);
            default:
                return [];
        }
    }

    private async getRootChildren(): Promise<ConfigTreeItem[]> {
        // Return empty array if no config exists - this shows the welcome view
        const hasConfig = await this.configService.hasClaudeConfig();
        if (!hasConfig) {
            return [];
        }

        // Get current scope info
        const basePath = (this.configService as any).basePath || '/home/thinkube';
        const isGlobal = basePath === '/home/thinkube';
        const scopeName = isGlobal ? 'Global (All Projects)' : `Project: ${require('path').basename(basePath)}`;
        const scopeIcon = isGlobal ? 'home' : 'folder';

        // Create scope indicator item
        const scopeItem = new ConfigTreeItem(
            `📍 ${scopeName}`,
            'root',
            vscode.TreeItemCollapsibleState.None
        );
        scopeItem.tooltip = `Configuration location: ${basePath}/.claude/`;
        scopeItem.description = basePath;

        return [
            scopeItem,
            new ConfigTreeItem('Hooks', 'hooks-section', vscode.TreeItemCollapsibleState.Collapsed),
            new ConfigTreeItem('Commands', 'commands-section', vscode.TreeItemCollapsibleState.Collapsed),
            new ConfigTreeItem('Skills', 'skills-section', vscode.TreeItemCollapsibleState.Collapsed),
            new ConfigTreeItem('Agents', 'agents-section', vscode.TreeItemCollapsibleState.Collapsed),
            new ConfigTreeItem('MCP Servers', 'mcp-section', vscode.TreeItemCollapsibleState.Collapsed),
            new ConfigTreeItem('Permissions', 'permissions-section', vscode.TreeItemCollapsibleState.Collapsed),
        ];
    }

    private async getHooksChildren(): Promise<ConfigTreeItem[]> {
        return [
            new ConfigTreeItem('PreToolUse', 'hook-event', vscode.TreeItemCollapsibleState.Collapsed),
            new ConfigTreeItem('PostToolUse', 'hook-event', vscode.TreeItemCollapsibleState.Collapsed),
        ];
    }

    private async getHookEventChildren(event: 'PreToolUse' | 'PostToolUse'): Promise<ConfigTreeItem[]> {
        const hooks = await this.configService.getHooks(event);
        if (hooks.length === 0) {
            return [new ConfigTreeItem('No hooks configured', 'hook', vscode.TreeItemCollapsibleState.None)];
        }
        return hooks.map(hook =>
            new ConfigTreeItem(
                hook.matcher || '*',
                'hook',
                vscode.TreeItemCollapsibleState.None,
                hook
            )
        );
    }

    private async getCommandsChildren(): Promise<ConfigTreeItem[]> {
        const commands = await this.configService.getCommands();
        if (commands.length === 0) {
            return [new ConfigTreeItem('No commands configured', 'command', vscode.TreeItemCollapsibleState.None)];
        }
        return commands.map(cmd =>
            new ConfigTreeItem(
                `/${cmd.name}`,
                'command',
                vscode.TreeItemCollapsibleState.None,
                cmd
            )
        );
    }

    private async getSkillsChildren(): Promise<ConfigTreeItem[]> {
        const skills = await this.configService.getSkills();
        if (skills.length === 0) {
            return [new ConfigTreeItem('No skills configured', 'skill', vscode.TreeItemCollapsibleState.None)];
        }
        return skills.map(skill =>
            new ConfigTreeItem(
                skill.name,
                'skill',
                vscode.TreeItemCollapsibleState.None,
                skill
            )
        );
    }

    private async getAgentsChildren(): Promise<ConfigTreeItem[]> {
        const agents = await this.configService.getAgents();
        if (agents.length === 0) {
            return [new ConfigTreeItem('No agents configured', 'agent', vscode.TreeItemCollapsibleState.None)];
        }
        return agents.map(agent =>
            new ConfigTreeItem(
                agent.name,
                'agent',
                vscode.TreeItemCollapsibleState.None,
                agent
            )
        );
    }

    private async getMcpChildren(): Promise<ConfigTreeItem[]> {
        const servers = await this.configService.getMcpServers();
        if (servers.length === 0) {
            return [new ConfigTreeItem('No MCP servers configured', 'mcp-server', vscode.TreeItemCollapsibleState.None)];
        }
        return servers.map(server =>
            new ConfigTreeItem(
                server.name,
                'mcp-server',
                vscode.TreeItemCollapsibleState.None,
                server
            )
        );
    }

    private getPermissionsChildren(): ConfigTreeItem[] {
        return [
            new ConfigTreeItem('Allow', 'permission-allow', vscode.TreeItemCollapsibleState.Collapsed),
            new ConfigTreeItem('Deny', 'permission-deny', vscode.TreeItemCollapsibleState.Collapsed),
            new ConfigTreeItem('Ask', 'permission-ask', vscode.TreeItemCollapsibleState.Collapsed),
        ];
    }

    private async getPermissionItemsChildren(type: 'permission-allow' | 'permission-deny' | 'permission-ask'): Promise<ConfigTreeItem[]> {
        const permissions = await this.configService.getPermissions();
        let items: string[] = [];

        switch (type) {
            case 'permission-allow':
                items = permissions.allow;
                break;
            case 'permission-deny':
                items = permissions.deny;
                break;
            case 'permission-ask':
                items = permissions.ask;
                break;
        }

        if (items.length === 0) {
            return [new ConfigTreeItem('(empty)', 'permission-item', vscode.TreeItemCollapsibleState.None)];
        }

        return items.map(item =>
            new ConfigTreeItem(
                item,
                'permission-item',
                vscode.TreeItemCollapsibleState.None,
                item,
                type
            )
        );
    }
}
