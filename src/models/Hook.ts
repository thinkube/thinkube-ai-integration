/**
 * Hook - Claude Code hook configuration
 *
 * Hooks are scripts that execute before or after Claude Code uses tools.
 */

export type HookEvent = 'PreToolUse' | 'PostToolUse';

export interface HookDefinition {
    type: 'command';
    command: string;
    timeout?: number;
}

export interface HookMatcher {
    matcher: string;  // Tool pattern, e.g., "Edit|Write"
    hooks: HookDefinition[];
}

export interface Hook {
    id: string;           // Auto-generated unique ID
    event: HookEvent;
    matcher: string;
    command: string;
    timeout?: number;
    filePath?: string;    // Path to the hook script
}

export function createHook(
    event: HookEvent,
    matcher: string,
    command: string,
    timeout?: number
): Hook {
    return {
        id: `${event}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        event,
        matcher,
        command,
        timeout
    };
}

export function hookToConfig(hook: Hook): HookMatcher {
    return {
        matcher: hook.matcher,
        hooks: [{
            type: 'command',
            command: hook.command,
            ...(hook.timeout && { timeout: hook.timeout })
        }]
    };
}
