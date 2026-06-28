/**
 * Kanban commands (thinkube.kanban.*).
 *
 * Files-first, per-repo surface (ADR-0006): `openKanban` opens the Tandem
 * thinking space of an enabled repo — one enabled repo opens directly, several offer a
 * quick-pick, none falls back to the in-memory demo thinking space. The real thinking space
 * rendering is owned by the ThinkingSpaces navigator's `thinkube.thinkingSpace.open`; this
 * palette command just routes there, so there is exactly one open-thinking space path.
 */
import * as vscode from "vscode";

import { AuthService } from "../github/AuthService";
import { GitHubService } from "../github/GitHubService";
import { InMemoryAdapter } from "../views/kanban/host/InMemoryAdapter";
import { KanbanPanel } from "../views/kanban/host/Panel";
import { discoverRepos } from "../views/thinkingSpaces/ThinkingSpaceNavigatorProvider";

interface KanbanDeps {
  // Retained for now so extension.ts wiring is untouched; the files-first
  // thinking space no longer reads GitHub, but the inbox + auth stack still hangs here.
  auth: AuthService;
  github: GitHubService;
  output: vscode.OutputChannel;
  extensionUri: vscode.Uri;
}

export function registerKanbanCommands(
  context: vscode.ExtensionContext,
  deps: KanbanDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.kanban.openKanban", () =>
      openKanban(deps),
    ),
    vscode.commands.registerCommand("thinkube.kanban.refreshFromGitHub", () =>
      refreshFromGitHub(deps),
    ),
  );
}

/**
 * Drops cached client + classifier state so the next read re-fetches from
 * GitHub. If the kanban panel is open, the user re-triggers a load by closing
 * and reopening it.
 */
async function refreshFromGitHub(deps: KanbanDeps): Promise<void> {
  deps.github.invalidate();
  deps.output.appendLine("[refreshFromGitHub] caches dropped");
  vscode.window.showInformationMessage(
    "GitHub state refreshed. Reopen the Kanban panel to pull fresh project state.",
  );
}

async function openKanban(deps: KanbanDeps): Promise<void> {
  const enabled = discoverRepos().filter((r) => r.enabled);

  // No enabled thinking space anywhere → the in-memory demo thinking space.
  if (enabled.length === 0) {
    try {
      await KanbanPanel.open({
        extensionUri: deps.extensionUri,
        adapter: new InMemoryAdapter(),
        output: deps.output,
      });
    } catch (err) {
      deps.output.appendLine(`[openKanban] failed: ${(err as Error).message}`);
      vscode.window.showErrorMessage(
        `Failed to open kanban: ${(err as Error).message}`,
      );
    }
    return;
  }

  const repo =
    enabled.length === 1
      ? enabled[0]
      : (
          await vscode.window.showQuickPick(
            enabled.map((r) => ({ label: r.name, description: r.rel, r })),
            { placeHolder: "Open which Tandem thinking space?" },
          )
        )?.r;
  if (!repo) return;
  await vscode.commands.executeCommand("thinkube.thinkingSpace.open", repo);
}
