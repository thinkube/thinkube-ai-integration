/**
 * ChatPanel - Embedded chat interface for Natural Language Setup
 *
 * Replaces floating input boxes with a persistent sidebar chat panel
 */

import * as vscode from 'vscode';
import { ClaudeAnalyzer } from '../../services/ClaudeAnalyzer';
import { ClaudeConfigService } from '../../services/ClaudeConfigService';
import type { ConfigSuggestion } from '../../services/ProjectAnalyzer';

export class ChatPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'thinkube.chatPanel';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private configService: ClaudeConfigService
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'askClaude':
                    await this.handleUserQuery(data.message);
                    break;
                case 'applySuggestion':
                    await this.applySuggestion(data.suggestion);
                    break;
            }
        });
    }

    private async handleUserQuery(userMessage: string) {
        // Show user message in chat
        this._view?.webview.postMessage({
            type: 'userMessage',
            message: userMessage
        });

        // Show thinking indicator
        this._view?.webview.postMessage({
            type: 'thinking',
            show: true
        });

        try {
            // Get current workspace path
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                throw new Error('No workspace folder open');
            }

            const projectPath = workspaceFolders[0].uri.fsPath;

            // Ask Claude via Agent SDK
            const analyzer = new ClaudeAnalyzer();
            const result = await analyzer.analyzeProject(projectPath);

            // Hide thinking indicator
            this._view?.webview.postMessage({
                type: 'thinking',
                show: false
            });

            // Show Claude's response with suggestions
            this._view?.webview.postMessage({
                type: 'claudeResponse',
                summary: result.summary,
                suggestions: result.suggestions
            });

        } catch (error) {
            this._view?.webview.postMessage({
                type: 'thinking',
                show: false
            });

            this._view?.webview.postMessage({
                type: 'error',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
            });
        }
    }

    private async applySuggestion(suggestion: ConfigSuggestion) {
        try {
            const config = suggestion.config as any;

            switch (suggestion.type) {
                case 'hook':
                    await this.configService.addHook(
                        config.event,
                        { matcher: config.matcher, command: config.command }
                    );
                    break;
                case 'command':
                    await this.configService.createCommand(
                        config.name,
                        config.description,
                        config.content
                    );
                    break;
                case 'skill':
                    await this.configService.createSkill(
                        config.name,
                        config.description,
                        config.content
                    );
                    break;
                case 'agent':
                    await this.configService.createAgent(
                        config.name,
                        config.description,
                        config.content,
                        config.tools,
                        config.model
                    );
                    break;
                case 'mcp-server':
                    await this.configService.addMcpServer(
                        config.id,
                        {
                            command: config.command,
                            args: config.args,
                            env: config.env
                        }
                    );
                    break;
            }

            // Notify success
            this._view?.webview.postMessage({
                type: 'suggestionApplied',
                suggestion: suggestion.name
            });

        } catch (error) {
            this._view?.webview.postMessage({
                type: 'error',
                message: `Failed to apply: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Assistant</title>
    <style>
        body {
            padding: 0;
            margin: 0;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }

        #chat-container {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        #messages {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }

        .message {
            margin-bottom: 16px;
            padding: 8px 12px;
            border-radius: 4px;
        }

        .user-message {
            background: var(--vscode-input-background);
            border-left: 3px solid var(--vscode-inputOption-activeBorder);
        }

        .claude-message {
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
        }

        .suggestion {
            margin: 8px 0;
            padding: 8px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
            border: 1px solid var(--vscode-panel-border);
        }

        .suggestion-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        }

        .suggestion-type {
            font-size: 0.9em;
            opacity: 0.8;
            text-transform: uppercase;
        }

        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 12px;
            cursor: pointer;
            border-radius: 2px;
            font-size: 0.9em;
        }

        button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        #input-container {
            padding: 12px;
            background: var(--vscode-sideBar-background);
            border-top: 1px solid var(--vscode-panel-border);
        }

        #user-input {
            width: 100%;
            padding: 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-family: inherit;
            font-size: inherit;
            resize: vertical;
            min-height: 60px;
        }

        #user-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        #send-button {
            margin-top: 8px;
            width: 100%;
            padding: 8px;
        }

        .thinking {
            padding: 8px 12px;
            font-style: italic;
            opacity: 0.7;
        }

        .error {
            padding: 8px 12px;
            background: var(--vscode-inputValidation-errorBackground);
            border-left: 3px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 4px;
            margin: 8px 0;
        }
    </style>
</head>
<body>
    <div id="chat-container">
        <div id="messages">
            <div class="message claude-message">
                <strong>Claude Assistant</strong>
                <p>Hello! I can help you configure Claude Code for your project. Describe what you want to set up, and I'll analyze your codebase to suggest the right hooks, commands, skills, subagents, and MCP servers.</p>
                <p style="font-size: 0.9em; opacity: 0.8;">Example: "Set up code quality checks and testing workflows"</p>
            </div>
        </div>
        <div id="input-container">
            <textarea id="user-input" placeholder="Describe what you want Claude to do..."></textarea>
            <button id="send-button">Ask Claude</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const messagesDiv = document.getElementById('messages');
        const userInput = document.getElementById('user-input');
        const sendButton = document.getElementById('send-button');

        sendButton.addEventListener('click', sendMessage);
        userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                sendMessage();
            }
        });

        function sendMessage() {
            const message = userInput.value.trim();
            if (!message) return;

            vscode.postMessage({
                type: 'askClaude',
                message: message
            });

            userInput.value = '';
        }

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'userMessage':
                    addUserMessage(message.message);
                    break;
                case 'thinking':
                    if (message.show) {
                        addThinking();
                    } else {
                        removeThinking();
                    }
                    break;
                case 'claudeResponse':
                    addClaudeResponse(message.summary, message.suggestions);
                    break;
                case 'error':
                    addError(message.message);
                    break;
                case 'suggestionApplied':
                    showSuccess(\`Applied: \${message.suggestion}\`);
                    break;
            }
        });

        function addUserMessage(text) {
            const div = document.createElement('div');
            div.className = 'message user-message';
            div.innerHTML = \`<strong>You:</strong><p>\${escapeHtml(text)}</p>\`;
            messagesDiv.appendChild(div);
            scrollToBottom();
        }

        function addThinking() {
            const div = document.createElement('div');
            div.className = 'thinking';
            div.id = 'thinking-indicator';
            div.textContent = 'Claude is analyzing your project...';
            messagesDiv.appendChild(div);
            scrollToBottom();
        }

        function removeThinking() {
            const thinking = document.getElementById('thinking-indicator');
            if (thinking) {
                thinking.remove();
            }
        }

        function addClaudeResponse(summary, suggestions) {
            const div = document.createElement('div');
            div.className = 'message claude-message';

            let html = \`<strong>Claude:</strong><p>\${escapeHtml(summary)}</p>\`;

            if (suggestions && suggestions.length > 0) {
                html += '<div style="margin-top: 12px;">';
                suggestions.forEach((sug, index) => {
                    html += \`
                        <div class="suggestion">
                            <div class="suggestion-header">
                                <span><strong>\${escapeHtml(sug.name)}</strong> <span class="suggestion-type">(\${sug.type})</span></span>
                                <button onclick="applySuggestion(\${index})">Apply</button>
                            </div>
                            <p style="margin: 4px 0; font-size: 0.9em;">\${escapeHtml(sug.description)}</p>
                            <p style="margin: 4px 0; font-size: 0.85em; opacity: 0.7;">\${escapeHtml(sug.reason)}</p>
                        </div>
                    \`;
                });
                html += '</div>';
            }

            div.innerHTML = html;
            messagesDiv.appendChild(div);

            // Store suggestions for apply buttons
            window.currentSuggestions = suggestions;

            scrollToBottom();
        }

        function applySuggestion(index) {
            const suggestion = window.currentSuggestions[index];
            vscode.postMessage({
                type: 'applySuggestion',
                suggestion: suggestion
            });
        }

        function addError(text) {
            const div = document.createElement('div');
            div.className = 'error';
            div.innerHTML = \`<strong>Error:</strong> \${escapeHtml(text)}\`;
            messagesDiv.appendChild(div);
            scrollToBottom();
        }

        function showSuccess(text) {
            const div = document.createElement('div');
            div.className = 'message claude-message';
            div.innerHTML = \`<p>✓ \${escapeHtml(text)}</p>\`;
            messagesDiv.appendChild(div);
            scrollToBottom();
        }

        function scrollToBottom() {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>`;
    }

    public updateConfigService(newService: ClaudeConfigService) {
        this.configService = newService;
    }
}
