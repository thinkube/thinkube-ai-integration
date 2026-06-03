/**
 * Kanban / roadmap commands (thinkube.kanban.*).
 *
 * Chunk-3 surface: just the `dumpRoadmap` smoke command. It exists to verify
 * the GitHubService stack against a real repo + project without committing
 * to any UI yet. Output goes to a dedicated channel so the JSON tree is easy
 * to copy out and inspect.
 *
 * Each later chunk hangs additional commands here as the panels and the MCP
 * provider come online.
 */
import * as path from "node:path";

import * as vscode from "vscode";

import { AuthService } from "../github/AuthService";
import {
  GitHubService,
  IssueSummary,
  RepoCoords,
} from "../github/GitHubService";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { InMemoryAdapter } from "../views/kanban/host/InMemoryAdapter";
import { KanbanPanel } from "../views/kanban/host/Panel";
import { StorageAdapter } from "../views/kanban/host/StorageAdapter";
import { ThinkubeFilesAdapter } from "../views/kanban/host/storage/ThinkubeFilesAdapter";
import { decodeCardNumber } from "../views/kanban/host/storage/sliceBoard";

interface KanbanDeps {
  auth: AuthService;
  github: GitHubService;
  output: vscode.OutputChannel;
  store: ThinkubeStore | undefined;
  extensionUri: vscode.Uri;
}

export function registerKanbanCommands(
  context: vscode.ExtensionContext,
  deps: KanbanDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.kanban.dumpRoadmap", () =>
      dumpRoadmap(deps),
    ),
    vscode.commands.registerCommand("thinkube.kanban.smokeStore", () =>
      smokeStore(deps),
    ),
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
  const adapter = await pickAdapter(deps);
  if (!adapter) return;
  const store = deps.store;
  try {
    await KanbanPanel.open({
      extensionUri: deps.extensionUri,
      adapter,
      output: deps.output,
      // Files-first: a card's "detail" is its slice file open in the editor.
      openDetail: store
        ? async (issueNumber: number) => {
            const { specNumber, sliceNumber } = decodeCardNumber(issueNumber);
            const rel = store.pathForSlice(specNumber, sliceNumber);
            await vscode.window.showTextDocument(
              vscode.Uri.file(path.join(store.thinkubeDir, rel)),
            );
          }
        : undefined,
    });
  } catch (err) {
    deps.output.appendLine(`[openKanban] failed: ${(err as Error).message}`);
    vscode.window.showErrorMessage(
      `Failed to open kanban: ${(err as Error).message}`,
    );
  }
}

/**
 * Resolve which adapter to use: the files-backed ThinkubeFilesAdapter when a
 * methodology root is wired, otherwise the in-memory demo board.
 */
async function pickAdapter(
  deps: KanbanDeps,
): Promise<StorageAdapter | undefined> {
  // Files-first (ADR-0001/0007): render the board over the repo's committed
  // .thinkube/ via ThinkubeFilesAdapter whenever a methodology root is wired.
  if (deps.store) {
    const scope = path.basename(deps.store.workspaceRoot) || "Tandem board";
    const adapter = new ThinkubeFilesAdapter(deps.store, scope);
    adapter.watchExternal();
    return adapter;
  }
  // No methodology root yet → the in-memory demo board.
  return new InMemoryAdapter();
}

async function dumpRoadmap(deps: KanbanDeps): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("thinkube.kanban");
  const repoSetting = (cfg.get<string>("repo") ?? "").trim();
  const projectNumber = cfg.get<number>("projectNumber") ?? 0;

  if (!repoSetting.includes("/")) {
    vscode.window.showErrorMessage(
      "Thinkube Kanban: set `thinkube.kanban.repo` to `owner/repo` first.",
    );
    return;
  }
  const [owner, name] = repoSetting.split("/", 2);
  const coords: RepoCoords = { owner, name };

  deps.output.show(true);
  deps.output.appendLine(
    `[dumpRoadmap] ${coords.owner}/${coords.name} project=${projectNumber || "(none)"}`,
  );

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Dumping roadmap…",
    },
    async (progress) => {
      try {
        const mode = await deps.github.getClassifierMode(coords);
        deps.output.appendLine(`[dumpRoadmap] classifier mode: ${mode}`);
        progress.report({ message: "epics…" });

        const epics = await deps.github.listIssues(coords, {
          type: "epic",
          state: "open",
        });
        const tree = await Promise.all(
          epics.map(async (epic) => {
            const stories = await deps.github.listSubIssues(
              coords,
              epic.number,
            );
            const storyTrees = await Promise.all(
              stories.map(async (story) => {
                const specs = await deps.github.listSubIssues(
                  coords,
                  story.number,
                );
                const specTrees = await Promise.all(
                  specs.map(async (spec) => {
                    const tasks = await deps.github.listSubIssues(
                      coords,
                      spec.number,
                    );
                    return {
                      ...summarize(spec),
                      tasks: tasks.map(summarize),
                    };
                  }),
                );
                return { ...summarize(story), specs: specTrees };
              }),
            );
            return { ...summarize(epic), stories: storyTrees };
          }),
        );

        let project: unknown = null;
        if (projectNumber > 0) {
          progress.report({ message: "project…" });
          try {
            const info = await deps.github.getProject(owner, projectNumber);
            const items = await deps.github.listProjectItems(info.id);
            project = {
              id: info.id,
              number: info.number,
              title: info.title,
              url: info.url,
              statusField: info.statusField,
              items,
            };
          } catch (err) {
            deps.output.appendLine(
              `[dumpRoadmap] project fetch failed: ${(err as Error).message}`,
            );
          }
        }

        const payload = {
          repo: `${coords.owner}/${coords.name}`,
          classifierMode: mode,
          epics: tree,
          project,
          generatedAt: new Date().toISOString(),
        };

        deps.output.appendLine(JSON.stringify(payload, null, 2));
        deps.output.appendLine(`[dumpRoadmap] done — ${epics.length} epic(s)`);
      } catch (err) {
        deps.output.appendLine(
          `[dumpRoadmap] failed: ${(err as Error).message}`,
        );
        vscode.window.showErrorMessage(
          `Roadmap dump failed: ${(err as Error).message}`,
        );
      }
    },
  );
}

function summarize(issue: IssueSummary): {
  number: number;
  title: string;
  state: "open" | "closed";
  kind: string | undefined;
  url: string;
  nodeId: string;
} {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    kind: issue.kind,
    url: issue.url,
    nodeId: issue.nodeId,
  };
}

/**
 * Acceptance test for chunk 4: writes a sample `.thinkube/specs/SP-50.md`,
 * reads it back, listens for one watcher event, and resolves
 * `linkIssueToFile(50)`. All three results are reported in the Thinkube
 * Kanban output channel so the user can verify chunk 4 from the palette.
 */
async function smokeStore(deps: KanbanDeps): Promise<void> {
  const { store, output } = deps;
  if (!store) {
    vscode.window.showErrorMessage(
      "Thinkube store: no workspace folder is open.",
    );
    return;
  }

  output.show(true);
  const rel = store.pathFor("spec", 50);
  output.appendLine(`[smokeStore] target: ${rel}`);

  const watcherEvents: string[] = [];
  const sub = store.watch("spec", (change) => {
    if (change.relativePath === rel) {
      watcherEvents.push(`${change.type}@${new Date().toISOString()}`);
    }
  });

  try {
    const frontmatter = {
      kind: "spec" as const,
      issue: 50,
      parent_issue: 34,
      repo: "thinkube/example",
      created: new Date().toISOString().slice(0, 10),
    };
    const body =
      "# Smoke spec\n\n## Acceptance Criteria\n- [ ] thinkube store round-trips\n";
    await store.writeFile(rel, frontmatter, body);
    output.appendLine("[smokeStore] write: OK");

    const parsed = await store.getFile(rel);
    if (!parsed) {
      throw new Error("getFile returned undefined right after writeFile");
    }
    const roundTrip =
      parsed.frontmatter?.issue === 50 &&
      parsed.body.includes("Acceptance Criteria");
    output.appendLine(
      `[smokeStore] round-trip: ${roundTrip ? "OK" : "FAILED"}`,
    );

    // Give the FileSystemWatcher a tick to fire.
    await new Promise((r) => setTimeout(r, 750));
    output.appendLine(
      `[smokeStore] watcher events: ${watcherEvents.length} (${watcherEvents.join(", ") || "none"})`,
    );

    const path = await store.linkIssueToFile(50);
    output.appendLine(
      `[smokeStore] linkIssueToFile(50): ${path ?? "undefined"}`,
    );

    if (roundTrip && watcherEvents.length > 0 && path === rel) {
      output.appendLine("[smokeStore] ✅ acceptance criteria met");
      vscode.window.showInformationMessage("Thinkube store smoke test passed.");
    } else {
      output.appendLine(
        "[smokeStore] ❌ one or more checks failed — see above",
      );
      vscode.window.showWarningMessage(
        "Thinkube store smoke test had failures — see Thinkube Kanban output.",
      );
    }
  } catch (err) {
    output.appendLine(`[smokeStore] failed: ${(err as Error).message}`);
    vscode.window.showErrorMessage(
      `Smoke store failed: ${(err as Error).message}`,
    );
  } finally {
    sub.dispose();
  }
}
