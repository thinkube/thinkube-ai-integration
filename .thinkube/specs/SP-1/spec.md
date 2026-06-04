# Filter Thinking Spaces to configured boards

Add a title-bar icon toggle to the "Thinking Spaces" view that hides repos which aren't set up as a Thinking Space, leaving only the configured boards (those with a committed `.thinkube/`). No text input — a single icon that flips between "show all" and "configured only," and remembers its state across reloads.

## Acceptance Criteria

- [x] The "Thinking Spaces" view title bar has an **icon button** (no text input box) that toggles the list between "show all repos" and "configured only."
- [x] With the filter **on**, only configured Thinking Spaces (repos with a `.thinkube/` board) are listed; unconfigured repos are hidden.
- [x] With the filter **off** (default), all discovered repos appear as today, including unconfigured ones marked "— not enabled."
- [x] The title-bar **icon reflects the current state**, so the user can tell at a glance whether the list is filtered.
- [x] The chosen filter state **persists across a window reload** (it isn't reset every time the window reloads).

## Constraints

- Native `TreeDataProvider` only — no webview. Use the VS Code `view/title` menu + context-key toggle pattern so it works in **code-server**, where keybindings don't fire reliably (type-to-filter is out).
- Don't change `discoverRepos()` semantics or the "not enabled" rendering — the filter is a view-layer concern layered on top of the existing data.
- Preserve the existing bundle-status child rows and per-repo actions (open / enable / sessions).

## Design

Add a boolean filter state (`configuredOnly`) to `BoardNavigatorProvider`, persisted via `context.workspaceState`. The top-level branch of `getChildren()` filters `discoverRepos()` to `enabled === true` when the flag is on; everything else (bundle-status children, icons, contextValues, commands) is unchanged.

The toggle is exposed as two `view/title` commands sharing one handler — `thinkube.boards.showConfiguredOnly` (e.g. `$(filter)`) and `thinkube.boards.showAll` (e.g. `$(filter-filled)`) — made mutually visible by a `when` clause on a context key (`thinkube.boards.configuredOnly`). The handler flips the flag on the provider, calls `vscode.commands.executeCommand("setContext", …)`, persists the new value to `workspaceState`, and `refresh()`es the tree.

At activation the context key and the provider's flag are seeded from the persisted `workspaceState` value so the icon and the list match the saved state on the first paint after a reload.

## File Structure Plan

- `src/views/boards/BoardNavigatorProvider.ts` — add the `configuredOnly` flag + a setter that refreshes; filter the top-level `getChildren()` to `enabled` repos when the flag is on.
- `src/commands/boards.ts` — register the toggle command(s): flip provider state, `setContext`, persist to `workspaceState`.
- `package.json` — declare the two toggle commands with icons + add `view/title` menu entries (`when: view == thinkubeBoards && ...`).
- `src/extension.ts` — seed the context key + provider flag from persisted `workspaceState` at activation.
