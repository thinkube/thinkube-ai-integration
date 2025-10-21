import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectContext, detectProjectContext } from '../context/project';
import { launchClaudeWithContext } from '../integration/claude';
import { ThinkubeAPI } from '../integration/thinkube-api';

export async function createFromTemplate(uri?: vscode.Uri): Promise<void> {
    // Template selection
    const templates = [
        { 
            label: 'Vue + FastAPI', 
            value: 'vue-fastapi', 
            url: 'https://github.com/thinkube/tkt-webapp-vue-fastapi',
            description: 'Full-stack app with Vue.js frontend and FastAPI backend' 
        },
        { 
            label: 'Deploy from URL', 
            value: 'custom', 
            description: 'Deploy from a custom template URL' 
        }
    ];

    const selected = await vscode.window.showQuickPick(templates, {
        placeHolder: 'Select a template for your new app'
    });

    if (!selected) {
        return;
    }

    let templateUrl = selected.url;
    
    // If custom, prompt for URL
    if (selected.value === 'custom') {
        templateUrl = await vscode.window.showInputBox({
            prompt: 'Enter template repository URL',
            placeHolder: 'https://github.com/org/template-repo',
            validateInput: (value) => {
                if (!value || !value.match(/^https:\/\/github\.com\/[\w-]+\/[\w-]+$/)) {
                    return 'Please enter a valid GitHub repository URL';
                }
                return null;
            }
        });
        
        if (!templateUrl) {
            return;
        }
    }

    // App configuration
    const appName = await vscode.window.showInputBox({
        prompt: 'Enter app name',
        placeHolder: 'my-awesome-app',
        validateInput: (value) => {
            if (!value || !value.match(/^[a-z][a-z0-9-]*$/)) {
                return 'App name must start with a letter and contain only lowercase letters, numbers, and hyphens';
            }
            return null;
        }
    });

    if (!appName) {
        return;
    }

    // Additional configuration
    const description = await vscode.window.showInputBox({
        prompt: 'Enter app description',
        placeHolder: 'A fantastic application'
    });

    const authorName = await vscode.window.showInputBox({
        prompt: 'Enter your name',
        placeHolder: 'John Doe'
    });

    const authorEmail = await vscode.window.showInputBox({
        prompt: 'Enter your email',
        placeHolder: 'john@example.com'
    });

    // Deploy using the API
    const api = new ThinkubeAPI();
    
    try {
        // Show progress
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Deploying template',
            cancellable: false
        }, async (progress) => {
            progress.report({ message: 'Starting deployment...' });
            
            // Deploy template
            const response = await api.deployTemplateAsync({
                template_url: templateUrl!,
                template_name: appName,
                variables: {
                    project_description: description || 'A Thinkube application',
                    author_name: authorName || 'Thinkube User',
                    author_email: authorEmail || 'user@example.com'
                }
            });
            
            progress.report({ message: `Deployment queued: ${response.deployment_id}` });
            
            // Show options
            const choice = await vscode.window.showInformationMessage(
                `Template deployment started! ID: ${response.deployment_id}`,
                'Monitor Progress',
                'Open in Browser',
                'Continue Working'
            );
            
            if (choice === 'Monitor Progress') {
                await monitorDeployment(api, response.deployment_id);
            } else if (choice === 'Open in Browser') {
                api.openDeploymentInBrowser(response.deployment_id);
            }
        });
        
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to deploy template: ${error}`);
    }
}

async function monitorDeployment(api: ThinkubeAPI, deploymentId: string): Promise<void> {
    // Create output channel
    const outputChannel = vscode.window.createOutputChannel('Thinkube Deployment');
    outputChannel.show();
    
    outputChannel.appendLine(`Monitoring deployment: ${deploymentId}`);
    outputChannel.appendLine('=' .repeat(50));
    
    try {
        // Poll for status
        const finalStatus = await api.waitForDeployment(deploymentId, (status) => {
            outputChannel.appendLine(`Status: ${status.status}`);
        });
        
        // Get and display logs
        const logsResponse = await api.getDeploymentLogs(deploymentId, 0, 1000);
        
        outputChannel.appendLine('\nDeployment Logs:');
        outputChannel.appendLine('-' .repeat(50));
        
        for (const log of logsResponse.logs) {
            const timestamp = new Date(log.timestamp).toLocaleTimeString();
            outputChannel.appendLine(`[${timestamp}] ${log.type}: ${log.message}`);
        }
        
        outputChannel.appendLine('\n' + '=' .repeat(50));
        outputChannel.appendLine(`Deployment ${finalStatus.status}: ${finalStatus.name}`);
        
        if (finalStatus.status === 'success') {
            vscode.window.showInformationMessage(`Deployment completed successfully!`);
        } else {
            vscode.window.showErrorMessage(`Deployment failed: ${finalStatus.output}`);
        }
        
    } catch (error) {
        outputChannel.appendLine(`Error: ${error}`);
        vscode.window.showErrorMessage(`Failed to monitor deployment: ${error}`);
    }
}

export async function addService(uri?: vscode.Uri): Promise<void> {
    const folderPath = uri?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    if (!folderPath) {
        vscode.window.showErrorMessage('No folder selected for adding service');
        return;
    }

    // Detect project context
    const projectContext = await detectProjectContext(folderPath);
    
    // Service selection
    const services = [
        { label: 'PostgreSQL', value: 'postgresql', description: 'PostgreSQL database with migrations' },
        { label: 'Redis', value: 'redis', description: 'Redis for caching and sessions' },
        { label: 'Keycloak', value: 'keycloak', description: 'Keycloak for authentication' },
        { label: 'MinIO', value: 'minio', description: 'MinIO for object storage' },
        { label: 'RabbitMQ', value: 'rabbitmq', description: 'RabbitMQ for message queuing' }
    ];

    const selected = await vscode.window.showQuickPick(services, {
        placeHolder: 'Select a service to add to your project'
    });

    if (!selected) {
        return;
    }

    // Prepare context for Claude
    const context = {
        action: 'add_service',
        service: selected.value,
        projectType: projectContext.type,
        framework: projectContext.framework,
        existingServices: projectContext.services,
        instructions: `Add ${selected.label} service to the existing project. Include:
- Docker Compose configuration
- Environment variables
- Service initialization code
- Integration with the application
- Update documentation`
    };

    await launchClaudeWithContext(folderPath, context, false);
}

export async function generateComponent(uri?: vscode.Uri): Promise<void> {
    const folderPath = uri?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    if (!folderPath) {
        vscode.window.showErrorMessage('No folder selected for generating component');
        return;
    }

    const projectContext = await detectProjectContext(folderPath);
    
    if (!projectContext.framework.frontend) {
        vscode.window.showErrorMessage('No frontend framework detected in this project');
        return;
    }

    // Component configuration
    const componentName = await vscode.window.showInputBox({
        prompt: 'Enter component name',
        placeHolder: 'UserProfile, DataTable, etc.',
        validateInput: (value) => {
            if (!value || !value.match(/^[A-Z][a-zA-Z0-9]+$/)) {
                return 'Component name must be in PascalCase';
            }
            return null;
        }
    });

    if (!componentName) {
        return;
    }

    const componentTypes = [
        { label: 'Page Component', value: 'page' },
        { label: 'UI Component', value: 'ui' },
        { label: 'Layout Component', value: 'layout' },
        { label: 'Form Component', value: 'form' }
    ];

    const componentType = await vscode.window.showQuickPick(componentTypes, {
        placeHolder: 'Select component type'
    });

    if (!componentType) {
        return;
    }

    const context = {
        action: 'generate_component',
        componentName: componentName,
        componentType: componentType.value,
        framework: projectContext.framework.frontend,
        projectType: projectContext.type,
        instructions: `Generate a ${componentType.label} named "${componentName}" for ${projectContext.framework.frontend}. Include:
- Component file with TypeScript
- Styling (CSS/SCSS)
- Unit tests
- Storybook story (if applicable)
- Follow project conventions and patterns`
    };

    await launchClaudeWithContext(folderPath, context, false);
}

export async function generateAPI(uri?: vscode.Uri): Promise<void> {
    const folderPath = uri?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    if (!folderPath) {
        vscode.window.showErrorMessage('No folder selected for generating API');
        return;
    }

    const projectContext = await detectProjectContext(folderPath);
    
    if (!projectContext.framework.backend) {
        vscode.window.showErrorMessage('No backend framework detected in this project');
        return;
    }

    // API configuration
    const resourceName = await vscode.window.showInputBox({
        prompt: 'Enter resource name',
        placeHolder: 'users, products, orders, etc.',
        validateInput: (value) => {
            if (!value || !value.match(/^[a-z][a-z0-9_]*$/)) {
                return 'Resource name must be lowercase with underscores';
            }
            return null;
        }
    });

    if (!resourceName) {
        return;
    }

    const apiTypes = [
        { label: 'REST CRUD API', value: 'crud' },
        { label: 'GraphQL API', value: 'graphql' },
        { label: 'WebSocket API', value: 'websocket' },
        { label: 'Custom API', value: 'custom' }
    ];

    const apiType = await vscode.window.showQuickPick(apiTypes, {
        placeHolder: 'Select API type'
    });

    if (!apiType) {
        return;
    }

    const context = {
        action: 'generate_api',
        resourceName: resourceName,
        apiType: apiType.value,
        framework: projectContext.framework.backend,
        projectType: projectContext.type,
        hasDatabase: projectContext.services.includes('postgresql') || projectContext.services.includes('mysql'),
        instructions: `Generate a ${apiType.label} for "${resourceName}" resource using ${projectContext.framework.backend}. Include:
- API endpoints/resolvers
- Data models/schemas
- Validation
- Authentication/authorization
- Tests
- API documentation
- Follow RESTful conventions or GraphQL best practices`
    };

    await launchClaudeWithContext(folderPath, context, false);
}

export async function deployPreview(uri?: vscode.Uri): Promise<void> {
    const folderPath = uri?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    if (!folderPath) {
        vscode.window.showErrorMessage('No folder selected for deployment');
        return;
    }

    const projectContext = await detectProjectContext(folderPath);
    
    // For existing applications, guide to thinkube-control
    const choices = [
        {
            label: 'Open Thinkube Control',
            value: 'control',
            description: 'Deploy using the web interface'
        },
        {
            label: 'Generate Deployment Files',
            value: 'generate',
            description: 'Use Claude to create Kubernetes manifests'
        }
    ];
    
    const choice = await vscode.window.showQuickPick(choices, {
        placeHolder: 'How would you like to deploy?'
    });
    
    if (!choice) {
        return;
    }
    
    if (choice.value === 'control') {
        // Open thinkube control in browser
        const api = new ThinkubeAPI();
        try {
            await api.ensureAuthenticated();
            const config = vscode.workspace.getConfiguration('thinkube-ai');
            const domain = config.get('controlDomain', '');
            if (domain) {
                const url = `https://control.${domain}/deployments`;
                vscode.env.openExternal(vscode.Uri.parse(url));
            }
        } catch (error) {
            vscode.window.showErrorMessage('Please configure your Thinkube domain first');
        }
        return;
    }
    
    // Generate deployment files with Claude
    const context = {
        action: 'generate_deployment_files',
        projectType: projectContext.type,
        services: projectContext.services,
        hasDocker: projectContext.hasDocker,
        hasKubernetes: projectContext.hasKubernetes,
        instructions: `Generate Kubernetes deployment files for this ${projectContext.type || 'application'} to deploy on Thinkube. Include:
- Deployment/StatefulSet manifests
- Service definitions  
- Ingress configuration with proper domain
- ConfigMaps for configuration
- Secrets template (with placeholders)
- Namespace definition
- README with deployment instructions

Follow Thinkube conventions:
- Use namespace naming: app-name
- Use wildcard TLS certificate from default namespace
- Include health checks and probes
- Set appropriate resource limits
- Use Thinkube ingress patterns`
    };

    await launchClaudeWithContext(folderPath, context, false);
}