import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as appCommands from './commands/app';

interface ClaudeConfig {
    directories: string[];
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Thinkube AI Integration is now active!');

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

export function deactivate() {
    // Clean up if needed
}