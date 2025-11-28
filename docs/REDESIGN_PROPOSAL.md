# Thinkube AI Integration - Redesign Proposal

> **Version:** 1.0
> **Date:** 2025-01-25
> **Status:** Draft

## Executive Summary

This document proposes a reimagining of the Thinkube AI Integration VSCode extension from a "Claude launcher" to a comprehensive **Claude Code Configuration Manager**. The redesigned extension will provide:

1. **Worktree Manager** - Parallel development with git worktrees for both feature development and agent sandboxes
2. **Agent Workspaces** - Isolated environments with permission-restricted AI agents
3. **Config Explorer** - Visual management of Claude Code hooks, commands, skills, and agents
4. **MCP Server & Plugin Manager** - Discover, install, and configure MCP servers and community plugins
5. **Template Library** - Pre-built configurations for common workflows

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Vision & Goals](#2-vision--goals)
3. [Architecture](#3-architecture)
4. [Worktree Manager](#4-worktree-manager)
5. [Agent Workspaces](#5-agent-workspaces)
6. [Claude Code Config Management](#6-claude-code-config-management)
7. [MCP Servers & Plugin Management](#7-mcp-servers--plugin-management)
8. [Template Library](#8-template-library)
9. [User Interface Design](#9-user-interface-design)
10. [Implementation Roadmap](#10-implementation-roadmap)
11. [Technical Specifications](#11-technical-specifications)

---

## 1. Current State Analysis

### Existing Features

The current extension (v0.1.0) provides:

| Feature | Description |
|---------|-------------|
| Claude launcher | Open Claude Code in terminal with directory context |
| Session continuation | Continue existing Claude sessions |
| Reference directories | Add directories as context |
| Project configuration | Per-project Claude settings |
| Template deployment | Deploy apps via Thinkube Control API |
| Quick actions | Generate components, APIs, add services |

### Limitations

1. **Duplicates Claude's capabilities** - Most features already exist in Claude Code natively
2. **No unique value proposition** - Doesn't provide functionality beyond what Claude Code offers
3. **Limited integration** - Doesn't leverage Claude Code's advanced features (hooks, skills, agents)
4. **Manual configuration** - No visual tools for managing Claude Code configuration

### Opportunity

Claude Code has a rich ecosystem of extensibility features that are difficult to manage manually:
- Hooks (PreToolUse, PostToolUse)
- Custom slash commands
- Skills
- Subagents
- MCP servers
- Permissions

A VSCode extension can provide a **visual management layer** for these features while adding unique capabilities like worktree-based parallel development.

---

## 2. Vision & Goals

### Vision Statement

Transform the Thinkube AI Integration extension into the definitive **Claude Code Configuration Manager** - providing visual tools for managing Claude Code's advanced features and enabling novel workflows like agent-isolated worktrees.

### Goals

1. **Simplify configuration** - Visual editors for hooks, permissions, and settings
2. **Enable parallel development** - Git worktree integration for feature branches
3. **Safe agent sandboxing** - Isolated worktrees with restricted permissions for AI agents
4. **Accelerate adoption** - Template library for common configurations
5. **Maintain existing value** - Keep Thinkube Control API integration

### Non-Goals

- Duplicating Claude Code's core functionality
- Building a custom AI assistant
- Replacing Claude Code CLI

---

## 3. Architecture

### Directory Structure

```
thinkube-ai-integration/
├── src/
│   ├── extension.ts                    # Entry point, command registration
│   │
│   ├── views/                          # UI Components
│   │   ├── sidebar/
│   │   │   ├── WorktreeTreeProvider.ts     # Worktree sidebar tree
│   │   │   ├── ConfigTreeProvider.ts       # Claude config explorer
│   │   │   ├── McpServerTreeProvider.ts    # MCP server status tree
│   │   │   └── AgentStatusProvider.ts      # Running agent status
│   │   └── webviews/
│   │       ├── HooksEditorPanel.ts         # Hooks visual editor
│   │       ├── WizardPanel.ts              # Command/Skill/Agent wizard
│   │       ├── PermissionsPanel.ts         # Permissions editor
│   │       ├── McpServerManagerPanel.ts    # MCP server manager
│   │       └── McpServerConfigPanel.ts     # Server configuration dialog
│   │
│   ├── services/
│   │   ├── WorktreeService.ts              # Git worktree operations
│   │   ├── AgentWorktreeService.ts         # Agent workspace lifecycle
│   │   ├── ClaudeConfigService.ts          # Read/write .claude/ files
│   │   ├── McpServerService.ts             # MCP server management
│   │   ├── McpRegistryService.ts           # Plugin registry integration
│   │   ├── TemplateService.ts              # Template library management
│   │   ├── ClaudeLauncherService.ts        # Launch Claude in terminals
│   │   └── ThinkubeApiService.ts           # Existing API client (keep)
│   │
│   ├── models/
│   │   ├── Worktree.ts                     # Worktree data model
│   │   ├── AgentWorkspace.ts               # Agent workspace model
│   │   ├── ClaudeConfig.ts                 # Settings, hooks, permissions
│   │   ├── McpServer.ts                    # MCP server models
│   │   ├── Command.ts                      # Slash command model
│   │   ├── Skill.ts                        # Skill model
│   │   └── Agent.ts                        # Agent definition model
│   │
│   ├── templates/                      # Built-in templates
│   │   ├── hooks/
│   │   ├── commands/
│   │   ├── skills/
│   │   ├── agents/
│   │   ├── agent-workspaces/
│   │   └── mcp-servers/                    # MCP server templates
│   │
│   └── utils/
│       ├── yaml.ts                         # YAML frontmatter parsing
│       ├── git.ts                          # Git operations helper
│       └── validation.ts                   # Input validation
│
├── media/                              # Icons, CSS for webviews
│   ├── worktree.svg
│   ├── agent.svg
│   └── webview.css
│
└── package.json                        # Updated with new contributions
```

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VSCode Extension                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │   Sidebar   │  │  Webviews   │  │  Commands   │                  │
│  │  TreeView   │  │   Panels    │  │  Palette    │                  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                  │
│         │                │                │                          │
│         └────────────────┼────────────────┘                          │
│                          │                                           │
│                          ▼                                           │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                        Services Layer                          │  │
│  ├───────────────┬───────────────┬───────────────┬───────────────┤  │
│  │  Worktree     │  ClaudeConfig │   Template    │  Thinkube     │  │
│  │  Service      │  Service      │   Service     │  API Service  │  │
│  └───────┬───────┴───────┬───────┴───────┬───────┴───────┬───────┘  │
│          │               │               │               │          │
└──────────┼───────────────┼───────────────┼───────────────┼──────────┘
           │               │               │               │
           ▼               ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │   Git    │    │  .claude/│    │ Template │    │ Thinkube │
    │ Worktrees│    │  Files   │    │  Library │    │ Control  │
    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

---

## 4. Worktree Manager

### Overview

Git worktrees allow checking out multiple branches simultaneously in separate directories. This enables:

1. **Parallel feature development** - Work on multiple features without stashing/switching
2. **Agent sandboxing** - Give AI agents isolated workspaces with restricted permissions

### Directory Convention

For a repository named `my_app`, worktrees are created in a sibling directory `my_app_features`:

```
/home/user/projects/
├── my_app/                      # Main repository
└── my_app_features/             # Worktrees directory (sibling)
    ├── user-auth/               # git worktree for feature/user-auth
    ├── dashboard-redesign/      # git worktree for feature/dashboard
    ├── bugfix-login/            # git worktree for bugfix/login
    └── agent-code-reviewer/     # git worktree for agent workspace
```

### Benefits

| Benefit | Description |
|---------|-------------|
| **Clean separation** | Worktrees don't pollute the main repo |
| **Predictable location** | Always `{repo}_features/` next to repo |
| **Easy cleanup** | Delete entire `_features` folder when done |
| **Parallel Claude sessions** | Each worktree gets its own terminal |

### Worktree Modes

#### Mode 1: Feature Development

Traditional use case - parallel development of features by humans or Claude:

```typescript
interface Worktree {
  path: string;                    // /home/user/my_app_features/user-auth
  branch: string;                  // feature/user-auth
  type: 'feature';                 // Mode identifier
  repoRoot: string;                // /home/user/my_app
  featuresDir: string;             // /home/user/my_app_features
  name: string;                    // user-auth
  isMain: boolean;                 // false
}
```

#### Mode 2: Agent Workspace

Novel use case - isolated sandboxes for AI subagents:

```typescript
interface AgentWorkspace extends Worktree {
  type: 'agent';
  agentTemplate: string;           // 'code-reviewer', 'test-writer', etc.
  task: string;                    // What the agent is working on
  status: 'idle' | 'running' | 'completed' | 'failed';
  permissions: AgentPermissions;
  prNumber?: number;               // If PR was created
  createdAt: Date;
  completedAt?: Date;
}

interface AgentPermissions {
  canPush: boolean;                // false by default
  canModifyPaths: string[];        // ['src/tests/**', 'docs/**']
  mustPassChecks: string[];        // ['lint', 'test']
  requiresReview: boolean;         // true - must create PR
  autoCleanup: boolean;            // true - delete after PR merge
}
```

### WorktreeService API

```typescript
class WorktreeService {
  // Discovery
  async getWorktrees(repoPath: string): Promise<Worktree[]>
  async getFeaturesDir(repoPath: string): Promise<string>

  // Feature worktrees (Mode 1)
  async createFeatureWorktree(
    repoPath: string,
    branchName: string,
    baseBranch?: string
  ): Promise<Worktree>

  // Agent worktrees (Mode 2)
  async createAgentWorktree(
    repoPath: string,
    template: AgentTemplate,
    task: string
  ): Promise<AgentWorkspace>

  // Lifecycle
  async deleteWorktree(worktree: Worktree): Promise<void>
  async cleanupMergedWorktrees(repoPath: string): Promise<number>

  // Integration
  async openInNewWindow(worktree: Worktree): Promise<void>
  async launchClaude(worktree: Worktree): Promise<void>
  async createPullRequest(worktree: Worktree, title: string): Promise<string>
}
```

### Orchestration Workflow Example

```
User: "Add authentication and write tests for the API"

Orchestrator Agent:
├── Creates worktree: agent/auth-impl
│   └── Spawns auth-specialist subagent
│       └── Implements auth in isolation
│       └── Creates PR: feature/auth → main
│
├── Creates worktree: agent/test-writer
│   └── Spawns test-specialist subagent
│       └── Writes tests (can read main, writes to own worktree)
│       └── Creates PR: tests/api → main
│
└── Monitors both, merges when ready
```

---

## 5. Agent Workspaces

### Overview

Agent workspaces are specialized worktrees configured with restricted permissions for AI agents. Each workspace includes:

- Custom `.claude/settings.json` with permissions
- Agent-specific `CLAUDE.md` instructions
- Hooks to enforce constraints
- Optional self-contained agent definition

### Why Agent Workspaces?

| Benefit | Explanation |
|---------|-------------|
| **Isolation** | Agent changes don't affect main branch or other agents |
| **Safety** | If agent makes mistakes, discard worktree - no harm done |
| **Parallelism** | Multiple agents work simultaneously without conflicts |
| **Review** | Human reviews agent's PR before merging |
| **Audit trail** | Git history shows exactly what each agent did |
| **Reproducibility** | Can re-run agent in fresh worktree if needed |

### Agent Workspace Templates

#### 1. Code Reviewer

**Purpose:** Read-only code analysis, creates review comments

**Permissions:**
- Can read all files
- Cannot modify any files
- Can run git diff/log commands

**Directory Structure:**
```
agent-workspaces/code-reviewer/
├── .claude/
│   ├── settings.json
│   ├── CLAUDE.md
│   └── agents/
│       └── self.md
```

**settings.json:**
```json
{
  "permissions": {
    "allow": [
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git show:*)"
    ],
    "deny": [
      "Bash(git push:*)",
      "Bash(git commit:*)",
      "Edit",
      "Write"
    ],
    "ask": []
  }
}
```

**CLAUDE.md:**
```markdown
# Code Reviewer Agent Workspace

You are a code review agent working in an isolated worktree.

## Your Role
1. Analyze the code changes in this branch
2. Identify issues, improvements, and suggestions
3. Output a structured review report

## Constraints
- You are READ-ONLY - do not attempt to modify any files
- Focus on: correctness, security, performance, readability
- Be constructive and specific in your feedback

## Output
Create your review in `REVIEW.md` at the root of this workspace.
The review should include:
- Summary of changes
- Issues found (critical, major, minor)
- Suggestions for improvement
- Overall assessment
```

#### 2. Test Writer

**Purpose:** Write tests for existing code

**Permissions:**
- Can read all files
- Can only modify files in test directories
- Must pass test suite before completing

**settings.json:**
```json
{
  "permissions": {
    "allow": [
      "Bash(npm test:*)",
      "Bash(pytest:*)",
      "Bash(go test:*)"
    ],
    "deny": [],
    "ask": ["Edit", "Write"]
  },
  "hooks": {
    "PreToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": ".claude/hooks/only-tests.sh"
      }]
    }]
  }
}
```

**only-tests.sh:**
```bash
#!/bin/bash
# Block edits outside test directories
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Allow only test files
if [[ "$FILE_PATH" =~ ^.*(test|spec|__tests__|_test\.go).*$ ]] || \
   [[ "$FILE_PATH" =~ \.(test|spec)\.(ts|js|tsx|jsx|py)$ ]]; then
  exit 0
fi

cat <<EOF
{
  "decision": "block",
  "reason": "Test writer agent can only modify test files. Attempted to modify: $FILE_PATH"
}
EOF
exit 2
```

#### 3. Doc Writer

**Purpose:** Write and update documentation

**Permissions:**
- Can read all files
- Can only modify `docs/`, `*.md`, and docstrings

**settings.json:**
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": ".claude/hooks/only-docs.sh"
      }]
    }]
  }
}
```

**only-docs.sh:**
```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Allow docs directory and markdown files
if [[ "$FILE_PATH" =~ ^.*/docs/.*$ ]] || \
   [[ "$FILE_PATH" =~ \.md$ ]] || \
   [[ "$FILE_PATH" =~ ^.*/README.*$ ]]; then
  exit 0
fi

cat <<EOF
{
  "decision": "block",
  "reason": "Doc writer agent can only modify documentation files. Attempted: $FILE_PATH"
}
EOF
exit 2
```

#### 4. Refactorer

**Purpose:** Refactor code while maintaining functionality

**Permissions:**
- Can modify source files
- Must pass linting after every change
- Must pass tests before completing

**settings.json:**
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": ".claude/hooks/must-lint.sh",
        "timeout": 30000
      }]
    }]
  }
}
```

**must-lint.sh:**
```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // ""')

# Determine linter based on file extension
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx)
    npx eslint "$FILE_PATH" --fix
    RESULT=$?
    ;;
  *.py)
    ruff check "$FILE_PATH" --fix
    RESULT=$?
    ;;
  *.go)
    gofmt -w "$FILE_PATH"
    RESULT=$?
    ;;
  *)
    exit 0  # No linter for this file type
    ;;
esac

if [ $RESULT -ne 0 ]; then
  cat <<EOF
{
  "decision": "block",
  "reason": "Linting failed for $FILE_PATH. Please fix the issues."
}
EOF
  exit 2
fi

exit 0
```

#### 5. Security Auditor

**Purpose:** Analyze code for security vulnerabilities

**Permissions:**
- Read-only access
- Can run security scanning tools

**settings.json:**
```json
{
  "permissions": {
    "allow": [
      "Bash(npm audit:*)",
      "Bash(safety check:*)",
      "Bash(bandit:*)",
      "Bash(semgrep:*)"
    ],
    "deny": [
      "Edit",
      "Write",
      "Bash(git push:*)"
    ]
  }
}
```

### Agent Lifecycle

```
1. CREATE
   └── Create worktree in {repo}_features/agent-{name}/
   └── Copy template configuration
   └── Initialize git branch

2. CONFIGURE
   └── Apply permission restrictions
   └── Set up hooks
   └── Write agent instructions to CLAUDE.md

3. RUN
   └── Launch Claude Code in worktree
   └── Agent works within constraints
   └── Status tracked in extension

4. REVIEW
   └── Agent creates PR when done
   └── Human reviews changes
   └── Tests must pass

5. CLEANUP (automatic)
   └── PR merged or closed
   └── Worktree deleted
   └── Branch optionally deleted
```

---

## 6. Claude Code Config Management

### Overview

The extension provides visual tools for managing Claude Code's configuration files:

| File | Purpose |
|------|---------|
| `.claude/settings.json` | Hooks, permissions, MCP servers |
| `.claude/commands/*.md` | Custom slash commands |
| `.claude/skills/*/SKILL.md` | Reusable skills |
| `.claude/agents/*.md` | Subagent definitions |
| `CLAUDE.md` | Project instructions |

### ClaudeConfigService API

```typescript
class ClaudeConfigService {
  // Scope management
  async getConfig(scope: 'project' | 'global'): Promise<ClaudeConfig>
  async getEffectiveConfig(projectPath: string): Promise<ClaudeConfig>  // merged

  // Hooks
  async getHooks(): Promise<Hook[]>
  async addHook(event: 'PreToolUse' | 'PostToolUse', hook: HookConfig): Promise<void>
  async updateHook(id: string, hook: HookConfig): Promise<void>
  async deleteHook(id: string): Promise<void>

  // Commands
  async getCommands(): Promise<Command[]>
  async createCommand(command: CommandDefinition): Promise<string>
  async updateCommand(name: string, content: string): Promise<void>
  async deleteCommand(name: string): Promise<void>

  // Skills
  async getSkills(): Promise<Skill[]>
  async createSkill(skill: SkillDefinition): Promise<string>
  async updateSkill(name: string, content: string): Promise<void>
  async deleteSkill(name: string): Promise<void>

  // Agents
  async getAgents(): Promise<Agent[]>
  async createAgent(agent: AgentDefinition): Promise<string>
  async updateAgent(name: string, content: string): Promise<void>
  async deleteAgent(name: string): Promise<void>

  // Permissions
  async getPermissions(): Promise<Permissions>
  async setPermissions(permissions: Permissions): Promise<void>

  // MCP Servers
  async getMcpServers(): Promise<McpServer[]>
  async addMcpServer(name: string, config: McpServerConfig): Promise<void>
  async removeMcpServer(name: string): Promise<void>
}
```

### Configuration Models

```typescript
interface ClaudeConfig {
  hooks: {
    PreToolUse: HookConfig[];
    PostToolUse: HookConfig[];
  };
  permissions: {
    allow: string[];
    deny: string[];
    ask: string[];
  };
  mcpServers: Record<string, McpServerConfig>;
}

interface HookConfig {
  id: string;                      // Auto-generated
  matcher: string;                 // Tool pattern (e.g., "Edit|Write")
  type: 'command';
  command: string;                 // Path to script
  timeout?: number;                // Milliseconds
}

interface Command {
  name: string;                    // Slash command name
  description: string;
  argumentHint?: string;
  content: string;                 // Markdown content
  filePath: string;
}

interface Skill {
  name: string;
  description: string;
  tools: string[];
  model: 'inherit' | 'haiku' | 'sonnet';
  content: string;
  filePath: string;
}

interface Agent {
  name: string;
  description: string;
  tools: string[];
  model: 'inherit' | 'haiku' | 'sonnet';
  content: string;
  filePath: string;
}

interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}
```

---

## 7. MCP Servers & Plugin Management

### Overview

MCP (Model Context Protocol) servers extend Claude Code's capabilities by providing access to external tools, databases, APIs, and services. The extension provides comprehensive management for discovering, installing, configuring, and monitoring MCP servers.

### Why Plugin Management Matters

| Challenge | Solution |
|-----------|----------|
| **Discovery** | Hard to find useful MCP servers | Browse curated registry and community servers |
| **Installation** | Manual JSON editing in settings | One-click install with automatic configuration |
| **Configuration** | Complex environment variables | Visual configuration forms |
| **Debugging** | No visibility into server status | Real-time status, logs, and health checks |
| **Sharing** | Team members configure separately | Export/import server configurations |

### MCP Server Categories

#### Official/Core Servers

| Server | Purpose | Provider |
|--------|---------|----------|
| `filesystem` | Read/write files outside workspace | Anthropic |
| `git` | Advanced git operations | Anthropic |
| `github` | GitHub API integration | Anthropic |
| `postgres` | PostgreSQL database access | Anthropic |
| `sqlite` | SQLite database operations | Anthropic |
| `puppeteer` | Browser automation | Anthropic |
| `brave-search` | Web search | Anthropic |
| `fetch` | HTTP requests | Anthropic |

#### Community Servers

| Server | Purpose | Author |
|--------|---------|--------|
| `slack` | Slack workspace integration | Community |
| `notion` | Notion API access | Community |
| `linear` | Linear issue tracking | Community |
| `jira` | Jira integration | Community |
| `kubernetes` | K8s cluster management | Community |
| `docker` | Docker operations | Community |
| `aws` | AWS service access | Community |
| `gcp` | Google Cloud access | Community |

#### Custom/Private Servers

Organizations can create private MCP servers for:
- Internal APIs and services
- Proprietary databases
- Custom tooling
- Business logic automation

### McpServerService API

```typescript
class McpServerService {
  // Discovery
  async getRegistryServers(): Promise<McpServerInfo[]>
  async searchServers(query: string): Promise<McpServerInfo[]>
  async getServerDetails(serverId: string): Promise<McpServerDetails>

  // Installation
  async installServer(serverId: string, config?: Partial<McpServerConfig>): Promise<void>
  async installFromUrl(npmUrl: string): Promise<void>
  async installFromLocal(path: string): Promise<void>

  // Configuration
  async getInstalledServers(): Promise<InstalledMcpServer[]>
  async configureServer(serverId: string, config: McpServerConfig): Promise<void>
  async removeServer(serverId: string): Promise<void>

  // Runtime
  async getServerStatus(serverId: string): Promise<ServerStatus>
  async restartServer(serverId: string): Promise<void>
  async getServerLogs(serverId: string, lines?: number): Promise<string[]>

  // Import/Export
  async exportConfiguration(): Promise<McpExportBundle>
  async importConfiguration(bundle: McpExportBundle): Promise<void>
}

interface McpServerInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  repository: string;
  category: 'official' | 'community' | 'custom';
  tools: ToolInfo[];          // Tools this server provides
  configSchema: JSONSchema;   // Configuration options
  readme: string;
}

interface InstalledMcpServer {
  id: string;
  name: string;
  config: McpServerConfig;
  status: 'running' | 'stopped' | 'error';
  tools: string[];            // Available tool names
  lastStarted?: Date;
  errorMessage?: string;
}

interface McpServerConfig {
  command: string;            // e.g., "node", "python3", "npx"
  args: string[];             // Command arguments
  env?: Record<string, string>; // Environment variables
  autoStart?: boolean;        // Start with Claude Code
  timeout?: number;           // Connection timeout
}
```

### Plugin Configuration Models

```typescript
interface McpExportBundle {
  version: string;
  exportedAt: Date;
  servers: {
    id: string;
    config: McpServerConfig;
    notes?: string;
  }[];
}

interface ServerStatus {
  status: 'running' | 'stopped' | 'starting' | 'error';
  pid?: number;
  uptime?: number;            // Seconds
  toolsAvailable: string[];
  lastError?: string;
  memoryUsage?: number;       // MB
}
```

### UI: MCP Server Manager (Webview)

```
┌─────────────────────────────────────────────────────────────────────┐
│ MCP SERVER MANAGER                                           [⟳]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ 🔌 Installed Servers                                                │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ 🟢 github                                              [Config] │ │
│ │    Tools: create_issue, list_prs, merge_pr, ...                 │ │
│ │    Status: Running (uptime: 2h 34m)                             │ │
│ │                                         [Restart] [Logs] [🗑️]  │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ 🟢 postgres                                            [Config] │ │
│ │    Tools: query, list_tables, describe_table                    │ │
│ │    Status: Running                                              │ │
│ │    Connection: postgresql://localhost:5432/mydb                 │ │
│ │                                         [Restart] [Logs] [🗑️]  │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ 🔴 kubernetes                                          [Config] │ │
│ │    Tools: get_pods, get_deployments, apply_manifest             │ │
│ │    Status: Error - KUBECONFIG not found                         │ │
│ │                                    [Fix Config] [Logs] [🗑️]    │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ ─────────────────────────────────────────────────────────────────── │
│                                                                     │
│ 📦 Available Servers                                    [Search 🔍] │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Filter: [All ▼]  [Official] [Community] [Databases] [DevOps]    │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ 📦 slack                                              [Install] │ │
│ │    Slack workspace integration - send messages, read channels   │ │
│ │    ⭐ 4.5 (234 installs)                          by: community │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ 📦 notion                                             [Install] │ │
│ │    Notion API - pages, databases, blocks                        │ │
│ │    ⭐ 4.8 (567 installs)                          by: community │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ 📦 linear                                             [Install] │ │
│ │    Linear issue tracking integration                            │ │
│ │    ⭐ 4.6 (189 installs)                          by: community │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ ─────────────────────────────────────────────────────────────────── │
│                                                                     │
│ 🔧 Custom Server                                                    │
│ [+ Add from npm] [+ Add from path] [+ Import configuration]         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### UI: Server Configuration Dialog

```
┌─────────────────────────────────────────────────────────────────────┐
│ CONFIGURE: postgres                                          [Save] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Command:                                                            │
│ [npx                                                           ]    │
│                                                                     │
│ Arguments:                                                          │
│ [-y @modelcontextprotocol/server-postgres                      ]    │
│                                                                     │
│ ─────────────────────────────────────────────────────────────────── │
│                                                                     │
│ Environment Variables:                                              │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ POSTGRES_URL    [postgresql://user:pass@localhost:5432/db] [🗑️]│ │
│ │ POSTGRES_SSL    [require                                 ] [🗑️]│ │
│ └─────────────────────────────────────────────────────────────────┘ │
│ [+ Add Environment Variable]                                        │
│                                                                     │
│ ─────────────────────────────────────────────────────────────────── │
│                                                                     │
│ Options:                                                            │
│ [✓] Auto-start with Claude Code                                     │
│ [ ] Use secure credential storage                                   │
│ Connection timeout: [30        ] seconds                            │
│                                                                     │
│ ─────────────────────────────────────────────────────────────────── │
│                                                                     │
│ 🧪 Test Connection                                                  │
│ [Test Connection]  Status: ✅ Connected (3 tools available)         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Plugin Registry Integration

The extension can integrate with MCP server registries:

```typescript
interface PluginRegistry {
  name: string;
  url: string;
  type: 'official' | 'community' | 'private';
}

// Default registries
const DEFAULT_REGISTRIES: PluginRegistry[] = [
  {
    name: 'Official MCP Servers',
    url: 'https://registry.modelcontextprotocol.io/api/v1',
    type: 'official'
  },
  {
    name: 'Community Servers',
    url: 'https://mcp-community.io/api/v1',
    type: 'community'
  }
];
```

### Team Configuration Sharing

Teams can share MCP server configurations:

```json
// .claude/mcp-servers.shared.json
{
  "version": "1.0",
  "description": "Team shared MCP servers",
  "servers": {
    "company-api": {
      "command": "node",
      "args": ["/shared/mcp-servers/company-api/index.js"],
      "env": {
        "API_BASE_URL": "${COMPANY_API_URL}"
      },
      "notes": "Internal company API - requires VPN"
    },
    "postgres-staging": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_URL": "${STAGING_DB_URL}"
      },
      "notes": "Staging database - read-only access"
    }
  }
}
```

### Security Considerations

| Risk | Mitigation |
|------|------------|
| **Credential exposure** | Use VSCode SecretStorage for sensitive env vars |
| **Malicious servers** | Verify server signatures, show permission warnings |
| **Data exfiltration** | Audit which tools servers provide, network monitoring |
| **Resource abuse** | Memory/CPU limits, timeout enforcement |

### Custom Server Development

The extension can help developers create custom MCP servers:

```
┌─────────────────────────────────────────────────────────────────────┐
│ CREATE CUSTOM MCP SERVER                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Server Name: [my-company-api                               ]        │
│ Description: [Access to internal company APIs              ]        │
│                                                                     │
│ Language: [TypeScript ▼]                                            │
│           ├── TypeScript (recommended)                              │
│           ├── Python                                                │
│           └── Go                                                    │
│                                                                     │
│ Template: [REST API Wrapper ▼]                                      │
│           ├── Blank server                                          │
│           ├── REST API Wrapper                                      │
│           ├── Database connector                                    │
│           └── File system extension                                 │
│                                                                     │
│ Tools to create:                                                    │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ [✓] get_users     - Fetch users from API                        │ │
│ │ [✓] create_order  - Create new order                            │ │
│ │ [ ] + Add tool...                                               │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│                              [Cancel] [Generate Server Scaffold]    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. Template Library

### Overview

The extension includes a library of pre-built templates for common configurations. Users can browse, preview, and install templates to their projects.

### Template Categories

#### Hooks

| Template | Description | Trigger |
|----------|-------------|---------|
| `lint-on-save` | Run linter after Edit/Write, block if fails | PostToolUse |
| `block-secrets` | Prevent editing .env, credentials files | PreToolUse |
| `validate-tests` | Ensure tests pass after changes | PostToolUse |
| `format-on-save` | Auto-format code after edits | PostToolUse |
| `conventional-commits` | Enforce commit message format | PreToolUse (Bash) |
| `no-console-log` | Block console.log in production code | PostToolUse |

#### Commands

| Template | Description | Arguments |
|----------|-------------|-----------|
| `/review-pr` | Review a pull request by number | `<pr-number>` |
| `/implement-issue` | Implement a GitHub issue | `<issue-number>` |
| `/explain-code` | Explain selected code in detail | `<file-path>` |
| `/refactor` | Refactor code with specific goal | `<file-path>` |
| `/add-tests` | Add tests for a file/function | `<file-path>` |
| `/document` | Generate documentation | `<file-path>` |
| `/security-check` | Run security analysis | none |

#### Skills

| Template | Description | Tools |
|----------|-------------|-------|
| `code-review` | Comprehensive code review capability | Read, Bash |
| `test-generation` | Generate tests for given code | Read, Write, Bash |
| `refactoring` | Safe refactoring patterns | Read, Edit, Bash |
| `documentation` | Documentation generation | Read, Write |
| `security-audit` | Security vulnerability detection | Read, Bash |

#### Agents

| Template | Description | Restrictions |
|----------|-------------|--------------|
| `code-reviewer` | Read-only review agent | No Edit/Write |
| `test-writer` | Test file only agent | Only test files |
| `doc-writer` | Docs/markdown only agent | Only docs |
| `refactorer` | Modify with lint validation | Must pass lint |
| `security-auditor` | Read-only security analysis | No modifications |

#### Agent Workspaces

| Template | Description | Includes |
|----------|-------------|----------|
| `code-reviewer` | Full workspace for code review | settings.json, CLAUDE.md, agent |
| `test-writer` | Full workspace for test writing | settings.json, CLAUDE.md, hooks |
| `feature-developer` | Standard feature development | settings.json, CLAUDE.md |

#### MCP Servers

| Template | Description | Configuration |
|----------|-------------|---------------|
| `github` | GitHub API integration | Personal access token |
| `postgres` | PostgreSQL database access | Connection URL |
| `sqlite` | SQLite database operations | Database file path |
| `filesystem` | Extended file system access | Allowed directories |
| `brave-search` | Web search capability | API key |
| `slack` | Slack workspace integration | Bot token, workspace |
| `notion` | Notion API access | Integration token |
| `kubernetes` | K8s cluster management | Kubeconfig path |
| `docker` | Docker container operations | Socket path |
| `custom-api` | REST API wrapper scaffold | Base URL, auth config |

#### MCP Server Scaffolds

Pre-built project templates for creating custom MCP servers:

| Scaffold | Language | Use Case |
|----------|----------|----------|
| `typescript-basic` | TypeScript | Blank MCP server with tool definitions |
| `typescript-rest` | TypeScript | REST API wrapper with auth support |
| `typescript-db` | TypeScript | Database connector (generic) |
| `python-basic` | Python | Blank MCP server |
| `python-rest` | Python | REST API wrapper |
| `python-db` | Python | Database connector |

### Template File Format

Templates use YAML frontmatter for metadata:

```markdown
---
name: review-pr
version: 1.0.0
description: Review a pull request by number
category: command
author: thinkube
tags: [review, pr, github]
argument-hint: <pr-number>
---

# Review Pull Request #$ARGUMENTS

You are reviewing PR #$ARGUMENTS. Follow these steps:

## 1. Fetch PR Information
Use `gh pr view $ARGUMENTS` to get PR details.

## 2. Review Changes
...
```

### TemplateService API

```typescript
class TemplateService {
  // Discovery
  async getBuiltinTemplates(): Promise<Template[]>
  async getTemplatesByCategory(category: TemplateCategory): Promise<Template[]>

  // Installation
  async installTemplate(template: Template, targetPath: string): Promise<void>
  async installAgentWorkspace(template: AgentWorkspaceTemplate, worktreePath: string): Promise<void>

  // Preview
  async previewTemplate(template: Template): Promise<string>

  // Custom templates
  async importTemplate(path: string): Promise<Template>
  async exportAsTemplate(configPath: string): Promise<Template>
}
```

---

## 9. User Interface Design

### Sidebar Tree View

The extension adds a dedicated sidebar view for Claude Code management:

```
┌─────────────────────────────────────────────────┐
│ 🔧 THINKUBE AI                            [⚙️]  │
├─────────────────────────────────────────────────┤
│ 📄 CLAUDE.md                         [✏️] [👁️] │
├─────────────────────────────────────────────────┤
│ ▶ ⚙️ Configuration                              │
│   ├── 🔒 Permissions (3 allow, 0 deny)   [✏️]  │
│   └── 🪝 Hooks (2 configured)            [✏️]  │
├─────────────────────────────────────────────────┤
│ ▼ 🔌 MCP Servers (3)                     [➕]   │
│   ├── 🟢 github                    [⚙️] [Logs] │
│   │   └── Tools: create_issue, list_prs, ...   │
│   ├── 🟢 postgres                  [⚙️] [Logs] │
│   │   └── Tools: query, list_tables            │
│   ├── 🔴 kubernetes                [⚙️] [Fix]  │
│   │   └── Error: KUBECONFIG not found          │
│   └── + Browse & Install Servers               │
├─────────────────────────────────────────────────┤
│ ▶ 📜 Commands (3)                        [➕]   │
│   ├── /review-pr                         [▶️]  │
│   ├── /implement-issue                   [▶️]  │
│   └── /explain-code                      [▶️]  │
├─────────────────────────────────────────────────┤
│ ▶ 🎯 Skills (2)                          [➕]   │
│   ├── code-review                        [🧪]  │
│   └── test-generation                    [🧪]  │
├─────────────────────────────────────────────────┤
│ ▶ 🤖 Agents (2)                          [➕]   │
│   ├── code-reviewer                      [▶️]  │
│   └── test-writer                        [▶️]  │
├─────────────────────────────────────────────────┤
│ ▼ 🌳 Worktrees                           [➕]   │
│   │                                             │
│   │ 👤 Feature Development                      │
│   ├── main ⭐                     [📂] [Claude] │
│   ├── feature/user-auth          [📂] [Claude] │
│   └── + New Feature Branch                      │
│   │                                             │
│   │ 🤖 Agent Workspaces                         │
│   ├── agent/reviewer 🟢 Running   [Status] [🗑️]│
│   │   └── "Reviewing PR #42"                    │
│   ├── agent/tester 🟡 Idle       [▶️ Run] [🗑️] │
│   └── + Spawn Agent                             │
└─────────────────────────────────────────────────┘
```

### Hooks Editor (Webview)

```
┌─────────────────────────────────────────────────┐
│ HOOKS MANAGER                            [Save] │
├─────────────────────────────────────────────────┤
│                                                 │
│ PreToolUse Hooks                                │
│ ┌─────────────────────────────────────────────┐ │
│ │ ▶ Edit|Write                                │ │
│ │   Script: /path/to/validate-code.sh         │ │
│ │   Timeout: 120s                             │ │
│ │                              [Edit] [Delete]│ │
│ └─────────────────────────────────────────────┘ │
│ [+ Add PreToolUse Hook]                         │
│                                                 │
│ PostToolUse Hooks                               │
│ ┌─────────────────────────────────────────────┐ │
│ │ ▶ Bash                                      │ │
│ │   Script: /path/to/log-commands.sh          │ │
│ │   Timeout: 30s                              │ │
│ │                              [Edit] [Delete]│ │
│ └─────────────────────────────────────────────┘ │
│ [+ Add PostToolUse Hook]                        │
│                                                 │
│ ─────────────────────────────────────────────── │
│ 📚 Templates                                    │
│ [Lint on Save] [Block Secrets] [Format Code]    │
└─────────────────────────────────────────────────┘
```

### Permissions Editor (Webview)

```
┌─────────────────────────────────────────────────┐
│ PERMISSIONS                              [Save] │
├─────────────────────────────────────────────────┤
│                                                 │
│ ✅ Allow (auto-approved)                        │
│ ┌─────────────────────────────────────────────┐ │
│ │ Bash(git clone:*)                    [🗑️]  │ │
│ │ Bash(kubectl get:*)                  [🗑️]  │ │
│ │ Bash(python3:*)                      [🗑️]  │ │
│ └─────────────────────────────────────────────┘ │
│ [+ Add Allow Rule]                              │
│                                                 │
│ ❌ Deny (blocked)                               │
│ ┌─────────────────────────────────────────────┐ │
│ │ Bash(rm -rf /*)                      [🗑️]  │ │
│ └─────────────────────────────────────────────┘ │
│ [+ Add Deny Rule]                               │
│                                                 │
│ ❓ Ask (requires confirmation)                  │
│ ┌─────────────────────────────────────────────┐ │
│ │ Bash(git push --force:*)             [🗑️]  │ │
│ └─────────────────────────────────────────────┘ │
│ [+ Add Ask Rule]                                │
└─────────────────────────────────────────────────┘
```

### Command/Skill/Agent Wizard (Webview)

```
┌─────────────────────────────────────────────────┐
│ CREATE NEW SLASH COMMAND                        │
├─────────────────────────────────────────────────┤
│                                                 │
│ Name: /[review-pr                          ]    │
│                                                 │
│ Description:                                    │
│ [Review a pull request                     ]    │
│                                                 │
│ Argument Hint:                                  │
│ [<pr-number>                               ]    │
│                                                 │
│ Start from template:                            │
│ [None ▼]                                        │
│  ├── Code Review                                │
│  ├── Implement Issue                            │
│  └── Explain Code                               │
│                                                 │
│ ─────────────────────────────────────────────── │
│                                                 │
│ Preview:                                        │
│ ┌─────────────────────────────────────────────┐ │
│ │ ---                                         │ │
│ │ description: Review a pull request          │ │
│ │ argument-hint: <pr-number>                  │ │
│ │ ---                                         │ │
│ │                                             │ │
│ │ # Review PR $ARGUMENTS                      │ │
│ │                                             │ │
│ │ [Content will be added here...]             │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│                        [Cancel] [Create File]   │
└─────────────────────────────────────────────────┘
```

### Worktree Manager (Webview)

```
┌─────────────────────────────────────────────────┐
│ WORKTREE MANAGER                                │
├─────────────────────────────────────────────────┤
│                                                 │
│ Repository: my_app                              │
│ Features Directory: /home/user/my_app_features  │
│                                                 │
│ ─────────────────────────────────────────────── │
│                                                 │
│ 👤 Feature Worktrees                            │
│ ┌─────────────────────────────────────────────┐ │
│ │ 🌳 main ⭐ (primary)                        │ │
│ │    /home/user/my_app                        │ │
│ │    [Open Folder] [Launch Claude]            │ │
│ ├─────────────────────────────────────────────┤ │
│ │ 🌿 feature/user-auth                        │ │
│ │    /home/user/my_app_features/user-auth     │ │
│ │    [Open] [Claude] [Create PR] [Delete]     │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ [+ New Feature Worktree]                        │
│   Branch name: feature/[                   ]    │
│   Base branch: [main ▼]                         │
│                           [Create & Open]       │
│                                                 │
│ ─────────────────────────────────────────────── │
│                                                 │
│ 🤖 Agent Workspaces                             │
│ ┌─────────────────────────────────────────────┐ │
│ │ 🤖 agent/code-reviewer                      │ │
│ │    Status: 🟢 Running                       │ │
│ │    Task: "Reviewing PR #42"                 │ │
│ │    [View Status] [Stop] [Delete]            │ │
│ ├─────────────────────────────────────────────┤ │
│ │ 🤖 agent/test-writer                        │ │
│ │    Status: 🟡 Idle                          │ │
│ │    [Run] [Configure] [Delete]               │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ [+ Spawn Agent Workspace]                       │
│   Template: [Code Reviewer ▼]                   │
│   Task: [                                  ]    │
│                      [Create & Launch Agent]    │
│                                                 │
│ ─────────────────────────────────────────────── │
│                                                 │
│ 🧹 Cleanup                                      │
│ [Clean Merged Worktrees] (3 eligible)           │
│ [Delete All Agent Workspaces]                   │
└─────────────────────────────────────────────────┘
```

---

## 10. Implementation Roadmap

> **Priority Order:** Config Management → MCP Servers → Templates → Worktrees → Agent Workspaces
>
> This order prioritizes **daily workflow value** over advanced features.

### Phase 1: Foundation (Week 1-2)

**Goal:** Refactor existing code and establish new architecture

- [ ] Refactor existing code into service structure
- [ ] Create `ClaudeConfigService` for reading/writing `.claude/` files
- [ ] Create sidebar `TreeDataProvider` skeleton
- [ ] Add basic models (ClaudeConfig, Command, Skill, Agent)
- [ ] Add unit tests for services

**Deliverables:**
- New directory structure
- Working service layer
- Basic sidebar tree view

### Phase 2: Config Management UI (Week 3-4)

**Goal:** Visual editors for Claude Code configuration - **immediate daily value**

- [ ] Hooks visual editor (webview)
- [ ] Permissions editor (webview)
- [ ] Command wizard with templates
- [ ] Skill wizard with templates
- [ ] Agent wizard with templates
- [ ] CLAUDE.md editor with preview
- [ ] Config tree view in sidebar

**Deliverables:**
- Webview-based editors for hooks, permissions
- Wizards for creating commands, skills, agents
- Full CRUD for all config types

**Why first:** You'll use hooks, commands, and skills every day. This provides immediate productivity gains.

### Phase 3: MCP Server Management (Week 5-6)

**Goal:** Comprehensive MCP server discovery, installation, and management

- [ ] Create `McpServerService` for server lifecycle management
- [ ] Create `McpRegistryService` for plugin discovery
- [ ] MCP server manager webview (browse, install, configure)
- [ ] Server status monitoring (running, stopped, error)
- [ ] Server configuration dialog with env var management
- [ ] Server logs viewer
- [ ] Test connection functionality
- [ ] Import/export server configurations
- [ ] Team configuration sharing (.claude/mcp-servers.shared.json)

**Deliverables:**
- MCP server browser with registry integration
- One-click server installation
- Visual configuration editor
- Real-time status monitoring
- Configuration sharing

**Why second:** Natural extension of config management. Extends Claude's capabilities immediately.

### Phase 4: Template Library (Week 7-8)

**Goal:** Pre-built templates and browsing UI

- [ ] Bundle built-in templates (hooks, commands, skills, agents, MCP servers)
- [ ] Template browser webview
- [ ] Install template to project
- [ ] Custom template import/export
- [ ] Template documentation
- [ ] MCP server scaffold generator

**Deliverables:**
- 20+ built-in templates
- Template browser UI
- Import/export functionality
- Custom MCP server generator

**Why third:** Accelerates adoption of Phase 2 & 3 features with ready-to-use configs.

### Phase 5: Worktree Manager (Week 9-10)

**Goal:** Full feature worktree support for parallel development

- [ ] Create `WorktreeService` with git worktree operations
- [ ] Implement `{repo}_features/` directory convention
- [ ] Feature worktree creation (Mode 1)
- [ ] Open worktree in new VSCode window
- [ ] Launch Claude Code in worktree context
- [ ] Delete worktree with cleanup
- [ ] Worktree tree view in sidebar

**Deliverables:**
- Feature worktree creation/deletion
- VSCode integration (open in new window)
- Claude launcher for worktrees

**Why fifth:** Parallel development is powerful but used less frequently than daily config.

### Phase 6: Agent Workspaces (Week 11-12)

**Goal:** Isolated agent sandboxes with permissions

- [ ] Agent workspace templates (code-reviewer, test-writer, etc.)
- [ ] Agent worktree creation (Mode 2)
- [ ] Apply restricted permissions via settings.json
- [ ] Agent status tracking
- [ ] PR creation from agent worktree
- [ ] Auto-cleanup on PR merge

**Deliverables:**
- 5 agent workspace templates
- Agent lifecycle management
- Permission enforcement

**Why sixth:** Advanced automation that builds on worktree foundation.

### Phase 7: Polish & Documentation (Week 13-14)

**Goal:** Production-ready release

- [ ] Status bar integration
- [ ] Notifications and progress indicators
- [ ] Keyboard shortcuts
- [ ] Extension settings
- [ ] User documentation
- [ ] API documentation
- [ ] Release preparation

**Deliverables:**
- Polished UX
- Complete documentation
- v1.0.0 release

---

### Implementation Priority Summary

| Phase | Feature | Daily Value | Complexity |
|-------|---------|-------------|------------|
| 1 | Foundation | - | Low |
| 2 | **Config Management** | ⭐⭐⭐ High | Medium |
| 3 | **MCP Servers** | ⭐⭐⭐ High | Medium |
| 4 | Template Library | ⭐⭐ Medium | Low |
| 5 | Worktree Manager | ⭐ Weekly | Medium |
| 6 | Agent Workspaces | ⭐ Advanced | High |
| 7 | Polish | - | Low |

---

## 11. Technical Specifications

### VSCode API Usage

| Feature | VSCode API |
|---------|------------|
| Sidebar tree | `TreeDataProvider`, `TreeView` |
| Webviews | `WebviewPanel`, `WebviewViewProvider` |
| File watching | `FileSystemWatcher` |
| Terminal | `Terminal`, `TerminalOptions` |
| Commands | `commands.registerCommand` |
| Configuration | `workspace.getConfiguration` |
| Notifications | `window.showInformationMessage` |
| Quick picks | `window.showQuickPick` |
| Input boxes | `window.showInputBox` |
| Progress | `window.withProgress` |

### Dependencies

```json
{
  "dependencies": {
    "yaml": "^2.3.0"           // YAML parsing for frontmatter
  },
  "devDependencies": {
    "@types/vscode": "^1.100.0",
    "@types/node": "^24.0.0",
    "@vscode/vsce": "^2.22.0",
    "typescript": "^5.8.3",
    "vitest": "^1.0.0"         // Unit testing
  }
}
```

### Git Worktree Commands

```bash
# List worktrees
git worktree list --porcelain

# Create worktree
git worktree add ../my_app_features/feature-name -b feature/feature-name

# Remove worktree
git worktree remove ../my_app_features/feature-name

# Prune stale worktrees
git worktree prune
```

### Security Considerations

1. **API Token Storage** - Use VSCode SecretStorage API instead of plain text settings
2. **Hook Script Validation** - Validate hook scripts exist and are executable
3. **Permission Sanitization** - Validate permission patterns
4. **Path Traversal** - Prevent path traversal in file operations
5. **Template Validation** - Validate templates before installation

### Error Handling

```typescript
// Custom error types
class WorktreeError extends Error {
  constructor(message: string, public readonly worktree?: string) {
    super(message);
    this.name = 'WorktreeError';
  }
}

class ConfigError extends Error {
  constructor(message: string, public readonly file?: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Error handling pattern
async function createWorktree(name: string): Promise<Worktree> {
  try {
    // ... implementation
  } catch (error) {
    if (error instanceof WorktreeError) {
      vscode.window.showErrorMessage(`Worktree error: ${error.message}`);
    } else {
      vscode.window.showErrorMessage(`Unexpected error: ${error}`);
      console.error('Worktree creation failed:', error);
    }
    throw error;
  }
}
```

---

## Appendix A: Claude Code Configuration Reference

### settings.json Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "hooks": {
      "type": "object",
      "properties": {
        "PreToolUse": { "type": "array", "items": { "$ref": "#/definitions/hookConfig" } },
        "PostToolUse": { "type": "array", "items": { "$ref": "#/definitions/hookConfig" } }
      }
    },
    "permissions": {
      "type": "object",
      "properties": {
        "allow": { "type": "array", "items": { "type": "string" } },
        "deny": { "type": "array", "items": { "type": "string" } },
        "ask": { "type": "array", "items": { "type": "string" } }
      }
    },
    "mcp_servers": {
      "type": "object",
      "additionalProperties": { "$ref": "#/definitions/mcpServerConfig" }
    }
  },
  "definitions": {
    "hookConfig": {
      "type": "object",
      "properties": {
        "matcher": { "type": "string" },
        "hooks": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "type": { "type": "string", "enum": ["command"] },
              "command": { "type": "string" },
              "timeout": { "type": "number" }
            },
            "required": ["type", "command"]
          }
        }
      },
      "required": ["matcher", "hooks"]
    },
    "mcpServerConfig": {
      "type": "object",
      "properties": {
        "command": { "type": "string" },
        "args": { "type": "array", "items": { "type": "string" } },
        "env": { "type": "object", "additionalProperties": { "type": "string" } }
      },
      "required": ["command"]
    }
  }
}
```

### Command File Schema

```yaml
---
description: string (required)  # Shown in help
argument-hint: string           # e.g., "<file-path>"
---

# Markdown content
# $ARGUMENTS placeholder replaced with user input
```

### Skill File Schema

```yaml
---
name: string (required)
description: string (required)
tools: string                   # Comma-separated: "Read, Edit, Bash"
model: string                   # "inherit", "haiku", "sonnet"
---

# Markdown content with skill instructions
```

### Agent File Schema

```yaml
---
name: string (required)
description: string (required)
tools: string                   # Comma-separated: "Task, Skill, Read"
model: string                   # "inherit", "haiku", "sonnet"
---

# Markdown content with agent instructions
```

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Worktree** | A git feature allowing multiple working directories from one repository |
| **Agent Workspace** | A worktree configured with restricted permissions for an AI agent |
| **Hook** | A script that runs before or after Claude Code uses a tool |
| **Command** | A custom slash command defined in `.claude/commands/` |
| **Skill** | A reusable capability defined in `.claude/skills/` |
| **Agent** | A subagent definition in `.claude/agents/` |
| **MCP Server** | Model Context Protocol server extending Claude's capabilities |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-01-25 | Claude | Initial draft |
