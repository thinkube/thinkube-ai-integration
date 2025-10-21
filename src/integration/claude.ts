import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectContext } from '../context/project';

interface ClaudeContext {
    action: string;
    [key: string]: any;
}

export async function launchClaudeWithContext(
    workingDirectory: string,
    context: ClaudeContext,
    continueSession: boolean
): Promise<void> {
    // Create a temporary context file
    const contextDir = path.join(workingDirectory, '.thinkube', 'claude-context');
    if (!fs.existsSync(contextDir)) {
        fs.mkdirSync(contextDir, { recursive: true });
    }

    const contextFile = path.join(contextDir, `context-${Date.now()}.json`);
    const contextContent = {
        timestamp: new Date().toISOString(),
        workingDirectory: workingDirectory,
        ...context
    };

    fs.writeFileSync(contextFile, JSON.stringify(contextContent, null, 2));

    // Build Claude command with context
    let command = buildClaudeCommand(workingDirectory, continueSession);
    
    // Add context file as additional context
    command += ` --add-file "${contextFile}"`;
    
    // Add project-specific instructions
    const instructions = getProjectInstructions(context);
    if (instructions) {
        const instructionFile = path.join(contextDir, `instructions-${Date.now()}.md`);
        fs.writeFileSync(instructionFile, instructions);
        command += ` --add-file "${instructionFile}"`;
    }

    // Add relevant template files if creating from template
    if (context.action === 'create_app_from_template') {
        const templatePaths = getTemplatePaths(context.template);
        for (const templatePath of templatePaths) {
            if (fs.existsSync(templatePath)) {
                command += ` --add-dir "${templatePath}"`;
            }
        }
    }

    // Create and show terminal
    const terminalName = `Claude: ${context.action.replace(/_/g, ' ')}`;
    const terminal = vscode.window.createTerminal({
        name: terminalName,
        cwd: workingDirectory
    });

    terminal.show();
    terminal.sendText(command);

    // Show notification with context
    const showNotifications = vscode.workspace.getConfiguration('thinkube-ai').get('claude.showNotifications', true);
    if (showNotifications) {
        vscode.window.showInformationMessage(
            `Claude launched for: ${context.action.replace(/_/g, ' ')}`
        );
    }
}

function buildClaudeCommand(projectPath: string, continueSession: boolean): string {
    const config = loadClaudeConfig(projectPath);
    let cmd = 'claude';
    
    // Add configured directories
    config.directories.forEach(dir => {
        if (dir.startsWith('~')) {
            dir = dir.replace('~', process.env.HOME || '');
        }
        
        const fullPath = path.isAbsolute(dir) ? dir : path.resolve(projectPath, dir);
        
        if (fs.existsSync(fullPath)) {
            cmd += ` --add-dir "${fullPath}"`;
        }
    });
    
    if (continueSession) {
        cmd += ' --continue';
    }
    
    return cmd;
}

function loadClaudeConfig(projectPath: string): { directories: string[] } {
    const configDir = findThinkubeConfig(projectPath) || path.join(projectPath, '.thinkube');
    const configFile = path.join(configDir, 'claude-config');
    
    const config: { directories: string[] } = { directories: [] };
    
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

function getProjectInstructions(context: ClaudeContext): string {
    const instructions: string[] = [
        '# Thinkube Project Context',
        '',
        `## Action: ${context.action.replace(/_/g, ' ').toUpperCase()}`,
        '',
        '## Context Details:'
    ];

    // Add context-specific information
    Object.entries(context).forEach(([key, value]) => {
        if (key !== 'action' && key !== 'instructions') {
            instructions.push(`- **${key}**: ${JSON.stringify(value)}`);
        }
    });

    instructions.push('', '## Instructions:', context.instructions || '');

    // Add Thinkube-specific guidelines
    instructions.push(
        '',
        '## Thinkube Platform Guidelines:',
        '- Use Kubernetes deployments compatible with MicroK8s',
        '- Follow Thinkube naming conventions (lowercase, hyphens)',
        '- Include proper health checks and resource limits',
        '- Use ConfigMaps for configuration, Secrets for sensitive data',
        '- Follow the project structure patterns from tkt-webapp-vue-fastapi template',
        '- Ensure all services are properly integrated with Thinkube ingress',
        '- Use the domain pattern: {service}.{namespace}.thinkube.com'
    );

    return instructions.join('\n');
}

function getTemplatePaths(template: string): string[] {
    const paths: string[] = [];
    
    // Add template repository paths
    const templateBase = path.join(process.env.HOME || '', 'thinkube-platform', 'tkt-webapp-vue-fastapi');
    
    if (template === 'vue-fastapi') {
        paths.push(templateBase);
        paths.push(path.join(process.env.HOME || '', '.thinkube', 'templates', 'vue-fastapi'));
    } else if (template === 'django-react') {
        paths.push(path.join(process.env.HOME || '', '.thinkube', 'templates', 'django-react'));
    }
    
    // Filter out non-existent paths
    return paths.filter(p => fs.existsSync(p));
}