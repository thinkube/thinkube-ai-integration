/**
 * `/orchestrate` command (SP-tgs8nz_SL-1): dispatch the next Ready slice of a chosen Spec
 * via `OrchestratorService`. Thin vscode glue — resolves the active board repo, the spec,
 * and the worktree/board config, then calls `dispatchNext` and streams the worker's
 * JSON-log to an output channel. The dispatch logic + parsing are the unit-tested core;
 * the live worker outcome is the human's verdict.
 */
import * as vscode from "vscode";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { WorktreeService } from "../services/WorktreeService";
import { OrchestratorService } from "../services/OrchestratorService";
import {
  extractDiagnosis,
  buildAttendPrompt,
} from "../services/orchestratorCore";
import type { OwnershipArbiter } from "../services/OwnershipArbiter";
import type { LauncherService } from "../services/LauncherService";
import type { SpecsProvider } from "../views/boards/SpecsProvider";

export interface OrchestrateDeps {
  specsProvider: SpecsProvider;
  /** The arbiter is built async at activation — a getter so we read it when invoked. */
  getArbiter: () => OwnershipArbiter | undefined;
  /** Opens primed sessions for `/attend` (reuses the cwd-wrapper launcher). */
  launcher: LauncherService;
  /** Injectable for tests; defaults to real instances. */
  worktrees?: WorktreeService;
  output?: vscode.OutputChannel;
}

export function registerOrchestrateCommands(
  context: vscode.ExtensionContext,
  deps: OrchestrateDeps,
): void {
  const worktrees = deps.worktrees ?? new WorktreeService();
  const output =
    deps.output ?? vscode.window.createOutputChannel("Thinkube Orchestrator");
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand("thinkube.orchestrate", async () => {
      const repo = deps.specsProvider.repoEntry;
      if (!repo || !repo.enabled) {
        vscode.window.showInformationMessage(
          "Select an enabled thinking space to orchestrate.",
        );
        return;
      }
      const arbiter = deps.getArbiter();
      if (!arbiter) {
        vscode.window.showWarningMessage(
          "Orchestrator not ready — the ownership arbiter is still activating. Try again in a moment.",
        );
        return;
      }
      try {
        const store = new ThinkubeStore(repo.path, repo.boardDir);
        const specs = (await store.listSpecDirs())
          .map((d) => /SP-([^/]+)/.exec(d)?.[1])
          .filter((id): id is string => !!id);
        if (specs.length === 0) {
          vscode.window.showInformationMessage("No Specs on this board yet.");
          return;
        }
        const specId =
          specs.length === 1
            ? specs[0]
            : await vscode.window.showQuickPick(
                specs.map((id) => `SP-${id}`),
                { placeHolder: "Orchestrate which Spec's next Ready slice?" },
              );
        if (!specId) return;
        const spec = specId.replace(/^SP-/, "");

        const canonical =
          (await worktrees.canonicalRepo(repo.path)) ?? repo.path;
        const baseDir =
          vscode.workspace
            .getConfiguration("thinkube")
            .get<string>("worktree.baseDir")
            ?.trim() || undefined;
        const boardRoot =
          vscode.workspace
            .getConfiguration("thinkube.boards")
            .get<string>("root")
            ?.trim() || undefined;

        const orchestrator = new OrchestratorService({
          worktrees,
          arbiter,
          store,
          output,
          canonicalRepo: canonical,
          boardRoot,
          baseDir,
        });
        output.show(true);
        const cap =
          vscode.workspace
            .getConfiguration("thinkube.orchestrator")
            .get<number>("maxConcurrent") ?? 4;
        const results = await orchestrator.dispatchFrontier(spec, cap);
        if (results.length === 0) {
          vscode.window.showInformationMessage(
            `SP-${spec}: nothing to dispatch — no Ready + deps-satisfied slice.`,
          );
        } else {
          const advanced = results.filter((r) => r.advanced).length;
          const stuck = results.filter(
            (r) => r.success && r.verified === false,
          ).length;
          vscode.window.showInformationMessage(
            `SP-${spec}: dispatched ${results.length}, advanced ${advanced}` +
              (stuck ? `, ${stuck} verifier-red (left in Doing)` : ""),
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `Orchestrate failed: ${(err as Error).message}`,
        );
      }
    }),
    vscode.commands.registerCommand(
      "thinkube.floatOutSession",
      (handle?: string) => floatOutSession(context, handle),
    ),
    vscode.commands.registerCommand(
      "thinkube.attend",
      async (handle?: string) => {
        const repo = deps.specsProvider.repoEntry;
        if (!repo || !repo.enabled) {
          vscode.window.showInformationMessage(
            "Select an enabled thinking space to attend a slice.",
          );
          return;
        }
        try {
          const store = new ThinkubeStore(repo.path, repo.boardDir);
          const h = handle ?? (await pickAttentionSlice(store));
          if (!h) return;
          const m = /^SP-(.+)_SL-(\d+)$/.exec(h);
          if (!m) {
            vscode.window.showErrorMessage(`Bad slice handle "${h}".`);
            return;
          }
          const specId = m[1];
          const rel = store.pathForSlice(specId, Number(m[2]));
          const body = (await store.getFile(rel))?.body ?? "";
          const diagnosis = extractDiagnosis(body);

          const canonical =
            (await worktrees.canonicalRepo(repo.path)) ?? repo.path;
          const baseDir =
            vscode.workspace
              .getConfiguration("thinkube")
              .get<string>("worktree.baseDir")
              ?.trim() || undefined;
          const boardRoot =
            vscode.workspace
              .getConfiguration("thinkube.boards")
              .get<string>("root")
              ?.trim() || undefined;
          // Root the primed session in the slice's worktree (reuses the launcher / cwd-wrapper).
          const worktreePath = await worktrees.create(
            canonical,
            specId,
            baseDir,
            boardRoot,
          );
          await deps.launcher.openHere(
            vscode.Uri.file(worktreePath),
            buildAttendPrompt(h, diagnosis),
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `Attend failed: ${(err as Error).message}`,
          );
        }
      },
    ),
  );
}

/** Find requires-attention slices on the board and quick-pick one (or the only one). */
async function pickAttentionSlice(
  store: ThinkubeStore,
): Promise<string | undefined> {
  const handles: string[] = [];
  for (const dir of await store.listSpecDirs()) {
    const specId = /SP-([^/]+)/.exec(dir)?.[1];
    if (!specId) continue;
    for (const rel of await store.listSlices(specId)) {
      const fm = (await store.getFile(rel))?.frontmatter;
      if ((fm?.status ?? "") === "requires-attention") {
        const num = /SL-(\d+)\.md$/.exec(rel)?.[1];
        if (num) handles.push(store.sliceHandle(specId, Number(num)));
      }
    }
  }
  if (handles.length === 0) {
    vscode.window.showInformationMessage(
      "No requires-attention slices to attend.",
    );
    return undefined;
  }
  if (handles.length === 1) return handles[0];
  return vscode.window.showQuickPick(handles, {
    placeHolder: "Attend which requires-attention slice?",
  });
}

/**
 * Float a running session into a separate webview panel beside the editor (SP-tgs8nz AC7) —
 * the user can then "Move into New Window" onto a second monitor. On code-server, where the
 * auxiliary-window route is unreliable, this beside-panel IS the dedicated-window fallback.
 * The live JSON-log stream renders here; wiring its content source is the visual-verdict part.
 */
function floatOutSession(
  context: vscode.ExtensionContext,
  handle?: string,
): void {
  const title = handle ? `Session · ${handle}` : "Orchestrator Session";
  const panel = vscode.window.createWebviewPanel(
    "thinkubeSession",
    title,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { retainContextWhenHidden: true },
  );
  const safe = title.replace(/[&<>]/g, "");
  panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font:13px var(--vscode-editor-font-family,monospace);padding:8px;color:var(--vscode-foreground)}h1{font-size:13px;opacity:.7}#log{white-space:pre-wrap}</style></head><body><h1>${safe}</h1><div id="log">Live JSON-log renders here. Use the editor's “Move into New Window” to place it on a second monitor.</div></body></html>`;
  context.subscriptions.push(panel);
}
