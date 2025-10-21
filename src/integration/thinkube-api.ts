import * as vscode from 'vscode';
import * as https from 'https';
import { URL } from 'url';

export interface DeploymentRequest {
    template_url: string;
    template_name: string;
    variables: Record<string, any>;
}

export interface DeploymentResponse {
    deployment_id: string;
    status: string;
    message: string;
}

export interface DeploymentStatus {
    id: string;
    name: string;
    template_url: string;
    status: string;
    variables?: Record<string, any>;
    output?: string;
    created_at: string;
    started_at?: string;
    completed_at?: string;
    created_by: string;
    duration?: number;
}

export interface DeploymentLog {
    id: string;
    deployment_id: string;
    timestamp: string;
    type: string;
    message: string;
    task_name?: string;
    task_number?: number;
}

export class ThinkubeAPI {
    private domain: string;
    private token?: string;
    
    constructor() {
        // Try to get domain from workspace settings first
        const config = vscode.workspace.getConfiguration('thinkube-ai');
        this.domain = config.get('controlDomain', '');
        this.token = config.get('apiToken', '');
    }
    
    /**
     * Ensure we have a valid domain and token
     */
    async ensureAuthenticated(): Promise<void> {
        if (!this.domain) {
            // Prompt for domain
            const domain = await vscode.window.showInputBox({
                prompt: 'Enter your Thinkube domain (e.g., thinkube.com)',
                placeHolder: 'example.com',
                validateInput: (value) => {
                    if (!value || !value.match(/^[a-zA-Z0-9.-]+$/)) {
                        return 'Please enter a valid domain';
                    }
                    return null;
                }
            });
            
            if (!domain) {
                throw new Error('Domain is required');
            }
            
            this.domain = domain;
            
            // Save to settings
            const config = vscode.workspace.getConfiguration('thinkube-ai');
            await config.update('controlDomain', domain, vscode.ConfigurationTarget.Global);
        }
        
        if (!this.token) {
            // Prompt for token
            const token = await vscode.window.showInputBox({
                prompt: 'Enter your Thinkube API token',
                placeHolder: 'Your API token',
                password: true,
                validateInput: (value) => {
                    if (!value) {
                        return 'API token is required';
                    }
                    return null;
                }
            });
            
            if (!token) {
                throw new Error('API token is required');
            }
            
            this.token = token;
            
            // Save to settings (consider using SecretStorage in production)
            const config = vscode.workspace.getConfiguration('thinkube-ai');
            await config.update('apiToken', token, vscode.ConfigurationTarget.Global);
        }
    }
    
    /**
     * Make an authenticated API request
     */
    private async request<T>(
        method: string,
        path: string,
        body?: any
    ): Promise<T> {
        await this.ensureAuthenticated();
        
        return new Promise((resolve, reject) => {
            const url = new URL(path, `https://control.${this.domain}`);
            
            const options = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname + url.search,
                method: method,
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            };
            
            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(JSON.parse(data));
                        } else {
                            const error = JSON.parse(data);
                            reject(new Error(error.detail || `HTTP ${res.statusCode}`));
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${data}`));
                    }
                });
            });
            
            req.on('error', reject);
            
            if (body) {
                req.write(JSON.stringify(body));
            }
            
            req.end();
        });
    }
    
    /**
     * Deploy a template asynchronously
     */
    async deployTemplateAsync(request: DeploymentRequest): Promise<DeploymentResponse> {
        return this.request<DeploymentResponse>(
            'POST',
            '/api/v1/templates/deploy-async',
            request
        );
    }
    
    /**
     * Get deployment status
     */
    async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
        return this.request<DeploymentStatus>(
            'GET',
            `/api/v1/templates/deployments/${deploymentId}`
        );
    }
    
    /**
     * Get deployment logs
     */
    async getDeploymentLogs(
        deploymentId: string,
        offset: number = 0,
        limit: number = 100
    ): Promise<{ logs: DeploymentLog[], total_count: number, has_more: boolean }> {
        return this.request(
            'GET',
            `/api/v1/templates/deployments/${deploymentId}/logs?offset=${offset}&limit=${limit}`
        );
    }
    
    /**
     * Poll deployment until completion
     */
    async waitForDeployment(
        deploymentId: string,
        onProgress?: (status: DeploymentStatus) => void
    ): Promise<DeploymentStatus> {
        let status: DeploymentStatus;
        
        while (true) {
            status = await this.getDeploymentStatus(deploymentId);
            
            if (onProgress) {
                onProgress(status);
            }
            
            if (!['pending', 'running'].includes(status.status)) {
                break;
            }
            
            // Wait 2 seconds before next poll
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        return status;
    }
    
    /**
     * Open deployment in browser
     */
    openDeploymentInBrowser(deploymentId: string): void {
        const url = `https://control.${this.domain}/deployments/${deploymentId}`;
        vscode.env.openExternal(vscode.Uri.parse(url));
    }
    
    /**
     * Clear stored credentials
     */
    async clearCredentials(): Promise<void> {
        const config = vscode.workspace.getConfiguration('thinkube-ai');
        await config.update('controlDomain', undefined, vscode.ConfigurationTarget.Global);
        await config.update('apiToken', undefined, vscode.ConfigurationTarget.Global);
        this.domain = '';
        this.token = '';
    }
}