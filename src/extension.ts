import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as appCommands from './commands/app';
import { ClaudeConfigService } from './services/ClaudeConfigService';
import { ProjectAnalyzer, ConfigSuggestion } from './services/ProjectAnalyzer';
import { ConfigTreeProvider, ConfigTreeItem } from './views/sidebar/ConfigTreeProvider';
import { Command } from './models/Command';
import { Skill } from './models/Skill';
import { Agent } from './models/Agent';

interface ClaudeConfig {
    directories: string[];
}

// Global instances
let configService: ClaudeConfigService | undefined;
let treeProvider: ConfigTreeProvider | undefined;

/**
 * Update the context variable for whether .claude config exists
 */
async function updateConfigContext(): Promise<void> {
    if (configService) {
        const hasConfig = await configService.hasClaudeConfig();
        await vscode.commands.executeCommand('setContext', 'thinkube.hasClaudeConfig', hasConfig);
    } else {
        await vscode.commands.executeCommand('setContext', 'thinkube.hasClaudeConfig', false);
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Thinkube AI Integration is now active!');

    // Initialize ClaudeConfigService with workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        configService = new ClaudeConfigService(workspaceFolders[0].uri.fsPath);
        treeProvider = new ConfigTreeProvider(configService);

        // Register tree view
        const treeView = vscode.window.createTreeView('claudeConfigTree', {
            treeDataProvider: treeProvider,
            showCollapseAll: true
        });
        context.subscriptions.push(treeView);

        // Update context and refresh when config changes
        configService.onConfigChanged(() => {
            updateConfigContext();
        });

        // Initial context update
        updateConfigContext();
    } else {
        // No workspace - set context to false
        vscode.commands.executeCommand('setContext', 'thinkube.hasClaudeConfig', false);
    }

    // Register Claude Config sidebar commands
    registerConfigCommands(context);

    // Register existing Claude commands
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.claude.openHere', (uri?: vscode.Uri) => {
            launchClaude(uri, false);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.claude.continueHere', (uri?: vscode.Uri) => {
            launchClaude(uri, true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.claude.addDirectory', async () => {
            await addReferenceDirectory();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.claude.configureProject', async () => {
            await configureProject();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.claude.showConfiguration', async () => {
            await showCurrentConfiguration();
        })
    );

    // Register new app development commands
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.app.createFromTemplate', appCommands.createFromTemplate)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.app.addService', appCommands.addService)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.app.generateComponent', appCommands.generateComponent)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.app.generateAPI', appCommands.generateAPI)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-ai.deploy.preview', appCommands.deployPreview)
    );
}

function getTargetDirectory(uri?: vscode.Uri): string | undefined {
    if (uri && uri.fsPath) {
        return uri.fsPath;
    }

    const editor = vscode.window.activeTextEditor;
    if (editor) {
        return path.dirname(editor.document.uri.fsPath);
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        return workspaceFolders[0].uri.fsPath;
    }

    return undefined;
}

function findThinkubeConfig(startPath: string): string | null {
    let currentPath = startPath;
    while (currentPath !== path.dirname(currentPath)) {
        const configPath = path.join(currentPath, '.thinkube');
        if (fs.existsSync(configPath)) {
            return configPath;
        }
        currentPath = path.dirname(currentPath);
    }
    return null;
}

function loadClaudeConfig(projectPath: string): ClaudeConfig {
    const configDir = findThinkubeConfig(projectPath) || path.join(projectPath, '.thinkube');
    const configFile = path.join(configDir, 'claude-config');
    
    const config: ClaudeConfig = { directories: [] };
    
    if (!fs.existsSync(configFile)) {
        return config;
    }
    
    try {
        const content = fs.readFileSync(configFile, 'utf8');
        content.split('\n').forEach(line => {
            const match = line.match(/^add-dir:\s*(.+)$/);
            if (match) {
                config.directories.push(match[1].trim());
            }
        });
    } catch (error) {
        console.error('Error reading claude-config:', error);
    }
    
    return config;
}

function saveClaudeConfig(projectPath: string, config: ClaudeConfig): void {
    const configDir = findThinkubeConfig(projectPath) || path.join(projectPath, '.thinkube');
    
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    
    const configFile = path.join(configDir, 'claude-config');
    const content = [
        '# Thinkube Claude Code Configuration',
        '# Directories added here will be available to Claude for reference',
        '# Use ~ for home directory, relative paths are resolved from project root',
        '',
        ...config.directories.map(dir => `add-dir: ${dir}`)
    ].join('\n') + '\n';
    
    fs.writeFileSync(configFile, content, 'utf8');
}

function buildClaudeCommand(projectPath: string, continueSession: boolean): string {
    const config = loadClaudeConfig(projectPath);
    let cmd = 'claude';
    
    // Add configured directories
    config.directories.forEach(dir => {
        // Expand ~ to home directory
        if (dir.startsWith('~')) {
            dir = dir.replace('~', process.env.HOME || '');
        }
        
        // Make relative paths absolute
        const fullPath = path.isAbsolute(dir) ? dir : path.resolve(projectPath, dir);
        
        if (fs.existsSync(fullPath)) {
            cmd += ` --add-dir "${fullPath}"`;
        } else {
            console.warn(`Directory not found: ${fullPath}`);
        }
    });
    
    if (continueSession) {
        cmd += ' --continue';
    }
    
    return cmd;
}

function launchClaude(uri: vscode.Uri | undefined, continueSession: boolean): void {
    const folderPath = getTargetDirectory(uri);
    
    if (!folderPath) {
        vscode.window.showErrorMessage('No folder selected');
        return;
    }
    
    const terminalName = continueSession 
        ? `Claude Continue: ${path.basename(folderPath)}`
        : `Claude Code: ${path.basename(folderPath)}`;
    
    const terminal = vscode.window.createTerminal({
        name: terminalName,
        cwd: folderPath
    });
    
    terminal.show();
    
    const command = buildClaudeCommand(folderPath, continueSession);
    terminal.sendText(command);
    
    // Show what directories are being added
    const config = loadClaudeConfig(folderPath);
    if (config.directories.length > 0 && vscode.workspace.getConfiguration('thinkube-ai').get('claude.showNotifications', true)) {
        vscode.window.showInformationMessage(
            `Claude launched with ${config.directories.length} reference director${config.directories.length === 1 ? 'y' : 'ies'}`
        );
    }
}

async function addReferenceDirectory(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }
    
    const projectPath = workspaceFolders[0].uri.fsPath;
    
    const selectedUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Add Reference Directory',
        title: 'Select directory to add as Claude reference'
    });
    
    if (selectedUri && selectedUri[0]) {
        const config = loadClaudeConfig(projectPath);
        const newDir = selectedUri[0].fsPath;
        
        // Check if already exists
        if (!config.directories.includes(newDir)) {
            config.directories.push(newDir);
            saveClaudeConfig(projectPath, config);
            
            const showNotifications = vscode.workspace.getConfiguration('thinkube-ai').get('claude.showNotifications', true);
            if (showNotifications) {
                vscode.window.showInformationMessage(`Added reference directory: ${newDir}`);
            }
        } else {
            vscode.window.showInformationMessage('Directory already in configuration');
        }
    }
}

async function configureProject(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }
    
    const projectPath = workspaceFolders[0].uri.fsPath;
    const config = loadClaudeConfig(projectPath);
    
    if (config.directories.length === 0) {
        vscode.window.showInformationMessage('No reference directories configured. Use "Add Reference Directory" to add some.');
        return;
    }
    
    const quickPick = vscode.window.createQuickPick();
    quickPick.title = 'Claude Code Reference Directories';
    quickPick.placeholder = 'Select directories to remove or press ESC to close';
    quickPick.canSelectMany = true;
    quickPick.items = config.directories.map(dir => ({ 
        label: dir,
        description: fs.existsSync(dir) ? '' : '(not found)',
        picked: false 
    }));
    
    quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems.map(item => item.label);
        if (selected.length > 0) {
            config.directories = config.directories.filter(dir => !selected.includes(dir));
            saveClaudeConfig(projectPath, config);
            
            const showNotifications = vscode.workspace.getConfiguration('thinkube-ai').get('claude.showNotifications', true);
            if (showNotifications) {
                vscode.window.showInformationMessage(`Removed ${selected.length} director${selected.length === 1 ? 'y' : 'ies'}`);
            }
        }
        quickPick.dispose();
    });
    
    quickPick.show();
}

async function showCurrentConfiguration(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }
    
    const projectPath = workspaceFolders[0].uri.fsPath;
    const config = loadClaudeConfig(projectPath);
    
    if (config.directories.length === 0) {
        vscode.window.showInformationMessage('No reference directories configured.');
        return;
    }
    
    const message = config.directories.map((dir, index) => 
        `${index + 1}. ${dir}${fs.existsSync(dir) ? '' : ' (not found)'}`
    ).join('\n');
    
    vscode.window.showInformationMessage(`Claude Code Reference Directories:\n${message}`, { modal: true });
}

// Helper functions for smart setup

function getIconForType(type: string): string {
    switch (type) {
        case 'hook': return 'symbol-event';
        case 'command': return 'terminal';
        case 'skill': return 'mortar-board';
        case 'mcp-server': return 'server';
        default: return 'gear';
    }
}

interface Template {
    name: string;
    description: string;
    icon: string;
    includes: string[];
    suggestions: ConfigSuggestion[];
}

function getTemplates(): Template[] {
    return [
        {
            name: 'Code Quality',
            description: 'Linting and formatting hooks',
            icon: 'check',
            includes: ['ESLint hook', 'Prettier hook'],
            suggestions: [
                {
                    type: 'hook',
                    name: 'Lint on Edit',
                    description: 'Run linter after edits',
                    reason: 'Code quality template',
                    config: {
                        event: 'PostToolUse',
                        matcher: 'Edit',
                        command: 'npm run lint -- --fix "$CLAUDE_FILE_PATH" 2>/dev/null || true'
                    }
                },
                {
                    type: 'hook',
                    name: 'Format on Edit',
                    description: 'Format code after edits',
                    reason: 'Code quality template',
                    config: {
                        event: 'PostToolUse',
                        matcher: 'Edit',
                        command: 'npx prettier --write "$CLAUDE_FILE_PATH" 2>/dev/null || true'
                    }
                }
            ]
        },
        {
            name: 'Testing Workflow',
            description: 'Commands for running and writing tests',
            icon: 'beaker',
            includes: ['Run tests command', 'Test writer skill'],
            suggestions: [
                {
                    type: 'command',
                    name: 'run-tests',
                    description: 'Run test suite',
                    reason: 'Testing template',
                    config: {
                        name: 'run-tests',
                        description: 'Run the test suite and analyze results',
                        content: 'Run the project tests and report any failures. Suggest fixes for failing tests.'
                    }
                },
                {
                    type: 'skill',
                    name: 'test-writer',
                    description: 'Generate tests for code',
                    reason: 'Testing template',
                    config: {
                        name: 'test-writer',
                        description: 'Writes comprehensive tests for code',
                        content: '# Test Writer Skill\n\nWhen writing tests:\n1. Cover happy path and edge cases\n2. Test error conditions\n3. Use descriptive test names\n4. Follow existing test patterns in the project'
                    }
                }
            ]
        },
        {
            name: 'Code Review',
            description: 'Skills and commands for code review',
            icon: 'eye',
            includes: ['Code reviewer skill', 'Security check command'],
            suggestions: [
                {
                    type: 'skill',
                    name: 'code-reviewer',
                    description: 'Review code for issues',
                    reason: 'Code review template',
                    config: {
                        name: 'code-reviewer',
                        description: 'Reviews code for bugs, security issues, and best practices',
                        content: '# Code Reviewer\n\nAnalyze code for:\n- Potential bugs\n- Security vulnerabilities\n- Performance issues\n- Code style and readability\n\nProvide specific, actionable feedback.'
                    }
                },
                {
                    type: 'command',
                    name: 'security-check',
                    description: 'Check for security issues',
                    reason: 'Code review template',
                    config: {
                        name: 'security-check',
                        description: 'Scan code for security vulnerabilities',
                        content: 'Review the codebase for security vulnerabilities including:\n- SQL injection\n- XSS\n- Authentication issues\n- Secrets in code\n- Insecure dependencies'
                    }
                }
            ]
        },
        {
            name: 'Documentation',
            description: 'Tools for writing documentation',
            icon: 'book',
            includes: ['Doc generator command', 'README updater'],
            suggestions: [
                {
                    type: 'command',
                    name: 'generate-docs',
                    description: 'Generate documentation',
                    reason: 'Documentation template',
                    config: {
                        name: 'generate-docs',
                        description: 'Generate documentation for code',
                        content: 'Generate or update documentation for the specified code. Include:\n- Function/class descriptions\n- Parameter documentation\n- Usage examples\n- Return value descriptions'
                    }
                },
                {
                    type: 'command',
                    name: 'update-readme',
                    description: 'Update project README',
                    reason: 'Documentation template',
                    config: {
                        name: 'update-readme',
                        description: 'Update the README based on current project state',
                        content: 'Review and update the README.md to reflect:\n- Current features\n- Installation steps\n- Usage examples\n- API documentation'
                    }
                }
            ]
        }
    ];
}

function parseNaturalLanguage(input: string): ConfigSuggestion | null {
    const lower = input.toLowerCase();

    // Hook patterns
    if (lower.includes('lint') && (lower.includes('after') || lower.includes('edit'))) {
        return {
            type: 'hook',
            name: 'Lint Hook',
            description: 'Run linter after Claude edits files',
            reason: 'Based on your request',
            config: {
                event: 'PostToolUse',
                matcher: 'Edit',
                command: 'npm run lint -- --fix "$CLAUDE_FILE_PATH" 2>/dev/null || true'
            }
        };
    }

    if (lower.includes('format') && (lower.includes('after') || lower.includes('edit'))) {
        return {
            type: 'hook',
            name: 'Format Hook',
            description: 'Format code after Claude edits files',
            reason: 'Based on your request',
            config: {
                event: 'PostToolUse',
                matcher: 'Edit',
                command: 'npx prettier --write "$CLAUDE_FILE_PATH" 2>/dev/null || true'
            }
        };
    }

    if (lower.includes('test') && (lower.includes('before') || lower.includes('commit'))) {
        return {
            type: 'hook',
            name: 'Test Before Commit',
            description: 'Run tests before Claude commits',
            reason: 'Based on your request',
            config: {
                event: 'PreToolUse',
                matcher: 'Bash(git commit:*)',
                command: 'npm test'
            }
        };
    }

    // Command patterns
    if (lower.includes('command') && lower.includes('review')) {
        return {
            type: 'command',
            name: 'review-code',
            description: 'Command to review code',
            reason: 'Based on your request',
            config: {
                name: 'review-code',
                description: 'Review code for issues and improvements',
                content: 'Review the selected code or file for:\n- Bugs and edge cases\n- Performance issues\n- Security vulnerabilities\n- Code style improvements'
            }
        };
    }

    if (lower.includes('command') && lower.includes('test')) {
        return {
            type: 'command',
            name: 'run-tests',
            description: 'Command to run tests',
            reason: 'Based on your request',
            config: {
                name: 'run-tests',
                description: 'Run and analyze tests',
                content: 'Run the test suite and report results. Fix any failing tests.'
            }
        };
    }

    // Skill patterns
    if (lower.includes('skill') && lower.includes('test')) {
        return {
            type: 'skill',
            name: 'test-writer',
            description: 'Skill for writing tests',
            reason: 'Based on your request',
            config: {
                name: 'test-writer',
                description: 'Writes comprehensive tests',
                content: '# Test Writer\n\nWrite thorough tests covering:\n- Happy path scenarios\n- Edge cases\n- Error conditions\n\nFollow existing test patterns in the project.'
            }
        };
    }

    if (lower.includes('skill') && (lower.includes('review') || lower.includes('code quality'))) {
        return {
            type: 'skill',
            name: 'code-reviewer',
            description: 'Skill for code review',
            reason: 'Based on your request',
            config: {
                name: 'code-reviewer',
                description: 'Reviews code for quality',
                content: '# Code Reviewer\n\nAnalyze code for bugs, security issues, performance problems, and style.\nProvide actionable feedback with specific suggestions.'
            }
        };
    }

    return null;
}

async function applySuggestion(service: ClaudeConfigService, suggestion: ConfigSuggestion): Promise<void> {
    const config = suggestion.config as unknown as Record<string, unknown>;

    switch (suggestion.type) {
        case 'hook':
            await service.addHook(
                config.event as 'PreToolUse' | 'PostToolUse',
                { matcher: config.matcher as string, command: config.command as string }
            );
            break;
        case 'command':
            await service.createCommand(
                config.name as string,
                config.description as string,
                config.content as string
            );
            break;
        case 'skill':
            await service.createSkill(
                config.name as string,
                config.description as string,
                config.content as string
            );
            break;
        case 'mcp-server':
            await service.addMcpServer(
                config.id as string,
                {
                    command: config.command as string,
                    args: config.args as string[],
                    env: config.env as Record<string, string> | undefined
                }
            );
            break;
    }
}

function registerConfigCommands(context: vscode.ExtensionContext): void {
    // Refresh configuration
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.refreshConfig', async () => {
            await updateConfigContext();
            treeProvider?.refresh();
        })
    );

    // Initialize Claude Config
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.initializeConfig', async () => {
            if (!configService) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }
            try {
                await configService.initializeClaudeConfig();
                await updateConfigContext();
                vscode.window.showInformationMessage('Claude Code configuration initialized');
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to initialize config: ${error}`);
            }
        })
    );

    // Smart Setup - Analyze project and suggest configurations
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.smartSetup', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || !configService) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Analyzing project...',
                cancellable: false
            }, async () => {
                const analyzer = new ProjectAnalyzer(workspaceFolders[0].uri.fsPath);
                const projectInfo = await analyzer.analyze();

                if (projectInfo.suggestions.length === 0) {
                    vscode.window.showInformationMessage('No specific suggestions for this project type. You can use manual setup or describe what you need.');
                    return;
                }

                // Show suggestions in a quick pick
                const items = projectInfo.suggestions.map(s => ({
                    label: `$(${getIconForType(s.type)}) ${s.name}`,
                    description: s.description,
                    detail: `${s.reason}`,
                    suggestion: s,
                    picked: true
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    canPickMany: true,
                    placeHolder: `Found ${projectInfo.tools.length} tools. Select configurations to apply:`,
                    title: `Smart Setup for ${projectInfo.name} (${projectInfo.type})`
                });

                if (selected && selected.length > 0) {
                    // Initialize config if needed
                    const hasConfig = await configService!.hasClaudeConfig();
                    if (!hasConfig) {
                        await configService!.initializeClaudeConfig();
                    }

                    // Apply selected suggestions
                    for (const item of selected) {
                        await applySuggestion(configService!, item.suggestion);
                    }

                    await updateConfigContext();
                    treeProvider?.refresh();
                    vscode.window.showInformationMessage(`Applied ${selected.length} configuration(s)`);
                }
            });
        })
    );

    // Natural Language Setup
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.naturalLanguageSetup', async () => {
            if (!configService) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }

            const input = await vscode.window.showInputBox({
                prompt: 'Describe what you want Claude to do',
                placeHolder: 'e.g., "Run tests before committing" or "Format code after edits"',
                ignoreFocusOut: true
            });

            if (!input) {
                return;
            }

            // Parse natural language and suggest config
            const suggestion = parseNaturalLanguage(input);

            if (suggestion) {
                const confirm = await vscode.window.showQuickPick(['Yes, apply this', 'No, let me refine'], {
                    placeHolder: `I'll create: ${suggestion.description}`
                });

                if (confirm === 'Yes, apply this') {
                    const hasConfig = await configService.hasClaudeConfig();
                    if (!hasConfig) {
                        await configService.initializeClaudeConfig();
                    }
                    await applySuggestion(configService, suggestion);
                    await updateConfigContext();
                    treeProvider?.refresh();
                    vscode.window.showInformationMessage(`Created: ${suggestion.name}`);
                }
            } else {
                vscode.window.showInformationMessage(
                    'I couldn\'t understand that request. Try something like:\n' +
                    '• "Run linting after edits"\n' +
                    '• "Create a command to review code"\n' +
                    '• "Add a skill for writing tests"'
                );
            }
        })
    );

    // Browse Templates
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.browseTemplates', async () => {
            if (!configService) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }

            const templates = getTemplates();
            const items = templates.map(t => ({
                label: `$(${t.icon}) ${t.name}`,
                description: t.description,
                detail: `Includes: ${t.includes.join(', ')}`,
                template: t
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a template to apply',
                title: 'Configuration Templates'
            });

            if (selected) {
                const hasConfig = await configService.hasClaudeConfig();
                if (!hasConfig) {
                    await configService.initializeClaudeConfig();
                }

                for (const suggestion of selected.template.suggestions) {
                    await applySuggestion(configService, suggestion);
                }

                await updateConfigContext();
                treeProvider?.refresh();
                vscode.window.showInformationMessage(`Applied template: ${selected.template.name}`);
            }
        })
    );

    // Add Hook
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.addHook', async () => {
            if (!configService) {
                return;
            }

            const event = await vscode.window.showQuickPick(['PreToolUse', 'PostToolUse'], {
                placeHolder: 'Select hook event type'
            });
            if (!event) {
                return;
            }

            const matcher = await vscode.window.showInputBox({
                prompt: 'Enter tool matcher pattern (e.g., "Bash", "Edit", "*")',
                value: '*'
            });
            if (!matcher) {
                return;
            }

            const command = await vscode.window.showInputBox({
                prompt: 'Enter command to execute',
                placeHolder: 'e.g., ./scripts/validate.sh'
            });
            if (!command) {
                return;
            }

            try {
                await configService.addHook(event as 'PreToolUse' | 'PostToolUse', {
                    matcher,
                    command
                });
                vscode.window.showInformationMessage('Hook added');
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to add hook: ${error}`);
            }
        })
    );

    // Delete Hook
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.deleteHook', async (item: ConfigTreeItem) => {
            if (!configService || !item.data) {
                return;
            }
            const hook = item.data as { id: string; event: string };
            try {
                await configService.deleteHook(hook.event as 'PreToolUse' | 'PostToolUse', hook.id);
                vscode.window.showInformationMessage('Hook deleted');
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to delete hook: ${error}`);
            }
        })
    );

    // Add Command
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.addCommand', async () => {
            if (!configService) {
                return;
            }

            const name = await vscode.window.showInputBox({
                prompt: 'Enter command name (without /)',
                placeHolder: 'e.g., review-code'
            });
            if (!name) {
                return;
            }

            const description = await vscode.window.showInputBox({
                prompt: 'Enter command description',
                placeHolder: 'e.g., Review the current file for issues'
            });

            try {
                const command = await configService.createCommand(
                    name,
                    description || '',
                    '# Add your prompt here\n\nDescribe what Claude should do when this command is invoked.'
                );
                // Open the created file
                const doc = await vscode.workspace.openTextDocument(command.filePath);
                await vscode.window.showTextDocument(doc);
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create command: ${error}`);
            }
        })
    );

    // Open Command
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.openCommand', async (cmd: Command) => {
            if (cmd && cmd.filePath) {
                const doc = await vscode.workspace.openTextDocument(cmd.filePath);
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    // Delete Command
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.deleteCommand', async (item: ConfigTreeItem) => {
            if (!configService || !item.data) {
                return;
            }
            const cmd = item.data as Command;
            const confirm = await vscode.window.showWarningMessage(
                `Delete command "/${cmd.name}"?`,
                { modal: true },
                'Delete'
            );
            if (confirm === 'Delete') {
                try {
                    await configService.deleteCommand(cmd.name);
                    vscode.window.showInformationMessage('Command deleted');
                    treeProvider?.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to delete command: ${error}`);
                }
            }
        })
    );

    // Add Skill
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.addSkill', async () => {
            if (!configService) {
                return;
            }

            const name = await vscode.window.showInputBox({
                prompt: 'Enter skill name',
                placeHolder: 'e.g., code-reviewer'
            });
            if (!name) {
                return;
            }

            const description = await vscode.window.showInputBox({
                prompt: 'Enter skill description',
                placeHolder: 'e.g., Reviews code for best practices and issues'
            });

            try {
                const skill = await configService.createSkill(
                    name,
                    description || '',
                    '# Skill Instructions\n\nDescribe what this skill does and how it should behave.'
                );
                const doc = await vscode.workspace.openTextDocument(skill.filePath);
                await vscode.window.showTextDocument(doc);
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create skill: ${error}`);
            }
        })
    );

    // Open Skill
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.openSkill', async (skill: Skill) => {
            if (skill && skill.filePath) {
                const doc = await vscode.workspace.openTextDocument(skill.filePath);
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    // Delete Skill
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.deleteSkill', async (item: ConfigTreeItem) => {
            if (!configService || !item.data) {
                return;
            }
            const skill = item.data as Skill;
            const confirm = await vscode.window.showWarningMessage(
                `Delete skill "${skill.name}"?`,
                { modal: true },
                'Delete'
            );
            if (confirm === 'Delete') {
                try {
                    await configService.deleteSkill(skill.name);
                    vscode.window.showInformationMessage('Skill deleted');
                    treeProvider?.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to delete skill: ${error}`);
                }
            }
        })
    );

    // Add Agent
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.addAgent', async () => {
            if (!configService) {
                return;
            }

            const name = await vscode.window.showInputBox({
                prompt: 'Enter agent name',
                placeHolder: 'e.g., test-runner'
            });
            if (!name) {
                return;
            }

            const description = await vscode.window.showInputBox({
                prompt: 'Enter agent description',
                placeHolder: 'e.g., Runs tests and reports results'
            });

            try {
                const agent = await configService.createAgent(
                    name,
                    description || '',
                    '# Agent Instructions\n\nDescribe what this agent does and how it should behave.'
                );
                const doc = await vscode.workspace.openTextDocument(agent.filePath);
                await vscode.window.showTextDocument(doc);
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create agent: ${error}`);
            }
        })
    );

    // Open Agent
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.openAgent', async (agent: Agent) => {
            if (agent && agent.filePath) {
                const doc = await vscode.workspace.openTextDocument(agent.filePath);
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    // Delete Agent
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.deleteAgent', async (item: ConfigTreeItem) => {
            if (!configService || !item.data) {
                return;
            }
            const agent = item.data as Agent;
            const confirm = await vscode.window.showWarningMessage(
                `Delete agent "${agent.name}"?`,
                { modal: true },
                'Delete'
            );
            if (confirm === 'Delete') {
                try {
                    await configService.deleteAgent(agent.name);
                    vscode.window.showInformationMessage('Agent deleted');
                    treeProvider?.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to delete agent: ${error}`);
                }
            }
        })
    );

    // Add MCP Server
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.addMcpServer', async () => {
            if (!configService) {
                return;
            }

            const id = await vscode.window.showInputBox({
                prompt: 'Enter server ID',
                placeHolder: 'e.g., github-mcp'
            });
            if (!id) {
                return;
            }

            const command = await vscode.window.showInputBox({
                prompt: 'Enter command to run the server',
                placeHolder: 'e.g., npx, node, python3'
            });
            if (!command) {
                return;
            }

            const argsStr = await vscode.window.showInputBox({
                prompt: 'Enter command arguments (comma-separated)',
                placeHolder: 'e.g., -y, @modelcontextprotocol/server-github'
            });

            const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];

            try {
                await configService.addMcpServer(id, {
                    command,
                    args
                });
                vscode.window.showInformationMessage(`MCP Server "${id}" added`);
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to add MCP server: ${error}`);
            }
        })
    );

    // Delete MCP Server
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.deleteMcpServer', async (item: ConfigTreeItem) => {
            if (!configService || !item.data) {
                return;
            }
            const server = item.data as { id: string; name: string };
            const confirm = await vscode.window.showWarningMessage(
                `Remove MCP server "${server.name}"?`,
                { modal: true },
                'Remove'
            );
            if (confirm === 'Remove') {
                try {
                    await configService.removeMcpServer(server.id);
                    vscode.window.showInformationMessage('MCP Server removed');
                    treeProvider?.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to remove MCP server: ${error}`);
                }
            }
        })
    );

    // Edit Permissions
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube.editPermissions', async () => {
            if (!configService) {
                return;
            }

            const permissions = await configService.getPermissions();
            const action = await vscode.window.showQuickPick(
                ['Add to Allow', 'Add to Deny', 'Add to Ask', 'View Current'],
                { placeHolder: 'Select action' }
            );

            if (!action) {
                return;
            }

            if (action === 'View Current') {
                const message = [
                    `Allow: ${permissions.allow.join(', ') || '(none)'}`,
                    `Deny: ${permissions.deny.join(', ') || '(none)'}`,
                    `Ask: ${permissions.ask.join(', ') || '(none)'}`
                ].join('\n');
                vscode.window.showInformationMessage(message, { modal: true });
                return;
            }

            const pattern = await vscode.window.showInputBox({
                prompt: 'Enter permission pattern',
                placeHolder: 'e.g., Bash(git:*), Edit, Read(**/secrets/**)'
            });

            if (!pattern) {
                return;
            }

            try {
                if (action === 'Add to Allow') {
                    permissions.allow.push(pattern);
                } else if (action === 'Add to Deny') {
                    permissions.deny.push(pattern);
                } else {
                    permissions.ask.push(pattern);
                }
                await configService.setPermissions(permissions);
                vscode.window.showInformationMessage('Permissions updated');
                treeProvider?.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to update permissions: ${error}`);
            }
        })
    );
}

export function deactivate() {
    // Clean up if needed
}