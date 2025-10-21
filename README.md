# Thinkube AI Integration

code-server extension for integrating AI assistants (currently Claude) into your development workflow within the Thinkube platform, with a focus on application development.

## Features

### Claude Code Integration

- **Context Menu Integration**: Right-click on any folder to access Claude Code commands
- **Smart Directory Management**: Add reference directories that Claude can access
- **Session Management**: Start new sessions or continue existing ones
- **Project Configuration**: Configure reference directories per project

### App Development Features (NEW)

- **Create from Template**: Generate new applications from Thinkube templates
- **Add Service**: Easily integrate PostgreSQL, Redis, Keycloak, MinIO, and more
- **Generate Component**: Create Vue/React/Angular components with proper structure
- **Generate API**: Build FastAPI/Django/Express endpoints with best practices
- **Deploy to Preview**: One-click deployment to Thinkube preview environment

### Commands

All commands are grouped under submenus in the context menu:

#### Claude Code Commands
- **Claude Code → Open Here**: Launch Claude in the selected directory
- **Claude Code → Continue Session**: Continue an existing Claude session
- **Claude Code → Add Reference Directory**: Add a directory for Claude to reference
- **Claude Code → Configure Project**: Manage reference directories
- **Claude Code → Show Configuration**: View current configuration

#### Quick Actions (App Development)
- **Claude Code → Quick Actions → Create from Template**: Start a new app from Vue+FastAPI or other templates
- **Claude Code → Quick Actions → Generate Component**: Create frontend components with tests and styling
- **Claude Code → Quick Actions → Generate API**: Build backend API endpoints with validation and docs
- **Claude Code → Quick Actions → Add Service**: Integrate databases, caching, auth, and storage services
- **Claude Code → Quick Actions → Deploy to Preview**: Deploy your app to the Thinkube preview environment

### Keyboard Shortcuts

- `Ctrl+Shift+C`: Open Claude in current file's directory
- `Ctrl+Shift+Alt+C`: Continue Claude session in current file's directory

## Installation

### From Open VSX Registry

```bash
# Once published to Open VSX
code-server --install-extension thinkube.thinkube-ai-integration
```

### From VSIX File

```bash
code-server --install-extension thinkube-ai-integration-1.0.0.vsix
```

### From Source

```bash
cd thinkube-ai-integration
npm install
npm run compile
npm run package
code-server --install-extension thinkube-ai-integration-1.0.0.vsix
```

## Configuration

### Project Configuration

Each project can have its own Claude configuration stored in `.thinkube/claude-config`:

```
# Thinkube Claude Code Configuration
# Directories added here will be available to Claude for reference
# Use ~ for home directory, relative paths are resolved from project root

add-dir: ~/shared-code/common-libs
add-dir: ./docs
add-dir: /home/thinkube/reference-data
```

### Extension Settings

- `thinkube-ai.claude.showNotifications`: Show notifications when adding/removing directories (default: true)
- `thinkube-ai.claude.defaultReferenceDirectories`: Default directories to add for all Claude sessions

## Usage

1. **Right-click on a folder** in the Explorer to see the Claude Code submenu
2. **Select "Open Here"** to launch Claude with that directory as context
3. **Add reference directories** that Claude should have access to
4. **Configure per-project** to maintain different contexts for different projects

## Requirements

- Claude CLI must be installed and authenticated
- code-server 1.100.0 or higher (as deployed in Thinkube)

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Package extension
npm run package
```

### Project Structure

```
thinkube-ai-integration/
├── src/
│   ├── extension.ts      # Main extension code
│   ├── commands/         # Command handlers
│   │   └── app.ts       # App development commands
│   ├── context/          # Context detection
│   │   └── project.ts   # Project type and framework detection
│   └── integration/      # External integrations
│       └── claude.ts    # Claude CLI integration
├── package.json          # Extension manifest
├── tsconfig.json         # TypeScript configuration
├── icon.png              # Extension icon
├── LICENSE               # Apache 2.0 license
└── README.md             # This file
```

## Future Enhancements

- Support for multiple AI engines (ChatGPT, Copilot, local LLMs)
- AI engine selection and configuration
- Custom prompts and templates
- Integration with Thinkube CI/CD pipeline

## License

Apache License 2.0 - Same as the Thinkube project

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🤖 AI-Assisted Development

This extension was developed with assistance from Claude AI as part of the Thinkube project.