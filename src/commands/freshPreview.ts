import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Open a file in the Markdown PREVIEW showing its CURRENT on-disk content.
 *
 * The delivery report / spec / TEP files live in the sidecar thinking space, which sits OUTSIDE the
 * code workspace folders — so VSCode's file watcher never fires for them. A preview (or editor) left
 * open from a PRIOR run therefore keeps its stale content, and a plain `markdown.showPreview` merely
 * REFOCUSES that stale tab: the run finishes green, but the report on screen is still the previous
 * run's failure. Closing any tab that targets this file first — the rendered preview webview AND any
 * raw editor holding a lagging document model — forces the reopen to render the file fresh from disk.
 */
export async function showFreshMarkdownPreview(uri: vscode.Uri): Promise<void> {
  const base = path.basename(uri.fsPath);
  const stale: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as
        | { uri?: vscode.Uri; viewType?: string }
        | undefined;
      // A raw editor for this exact file — its in-memory model can lag the disk after an
      // external (orchestrator) write, and the preview renders from that model when it exists.
      if (input?.uri?.fsPath === uri.fsPath) {
        stale.push(tab);
        continue;
      }
      // The built-in Markdown preview webview. Its input exposes no source uri, so match by the
      // webview viewType (`…markdown.preview`) plus the "Preview <file>" label. A basename clash
      // (two specs' DELIVERY.md) can over-close a sibling preview — harmless, it just reopens.
      if (
        typeof input?.viewType === "string" &&
        input.viewType.includes("markdown") &&
        tab.label.includes(base)
      ) {
        stale.push(tab);
      }
    }
  }
  if (stale.length) {
    try {
      await vscode.window.tabGroups.close(stale, true);
    } catch {
      /* best-effort — a tab may already be gone */
    }
  }
  await vscode.commands.executeCommand("markdown.showPreview", uri);
}
