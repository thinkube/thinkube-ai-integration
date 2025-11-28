/**
 * McpServer - MCP (Model Context Protocol) server configuration
 *
 * MCP servers extend Claude Code's capabilities by providing
 * access to external tools, databases, and services.
 */

export type McpServerStatus = 'running' | 'stopped' | 'starting' | 'error';
export type McpServerCategory = 'official' | 'community' | 'custom';

export interface McpServerConfig {
    command: string;              // e.g., "node", "python3", "npx"
    args: string[];               // Command arguments
    env?: Record<string, string>; // Environment variables
    autoStart?: boolean;          // Start with Claude Code
    timeout?: number;             // Connection timeout in ms
}

export interface McpServer {
    id: string;
    name: string;
    config: McpServerConfig;
    status?: McpServerStatus;
    tools?: string[];             // Available tool names
    errorMessage?: string;
}

export interface McpServerInfo {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    repository?: string;
    category: McpServerCategory;
    tools: string[];
    readme?: string;
}

export function createMcpServer(
    id: string,
    name: string,
    command: string,
    args: string[] = [],
    env?: Record<string, string>
): McpServer {
    return {
        id,
        name,
        config: {
            command,
            args,
            env,
            autoStart: true
        }
    };
}

export function mcpServerToConfig(servers: Record<string, McpServer>): Record<string, McpServerConfig> {
    const config: Record<string, McpServerConfig> = {};
    for (const [id, server] of Object.entries(servers)) {
        config[id] = server.config;
    }
    return config;
}
