/**
 * ProjectMembersProvider (SP-tgvl81_SL-2) — the dedicated member view for the
 * Project selected in the navigator. A Project is a promoted tag, so its members
 * are the items (specs/TEPs/slices) across every enabled board whose effective
 * tags include the project's tag. Resolution is host-side (per-repo
 * `ThinkubeStore` + `effectiveTags`); the pure filter is `projectMembers`.
 */
import * as vscode from "vscode";

import { ThinkubeStore } from "../../store/ThinkubeStore";
import { effectiveTags } from "../../store/frontmatter";
import { discoverRepos } from "./BoardNavigatorProvider";
import { projectMembers, MemberDesc, MemberItem } from "./productTree";

const SLICE_RE = /SP-([A-Za-z0-9]+)\/SL-(\d+)\.md$/;

export interface SelectedProject {
  product: string;
  name: string;
  tag: string;
}

export class ProjectMembersProvider
  implements vscode.TreeDataProvider<MemberDesc>
{
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private project: SelectedProject | undefined;

  /** Scope the view to a selected Project (or clear it). */
  setProject(project: SelectedProject | undefined): void {
    this.project = project;
    this._onDidChange.fire();
  }

  get selected(): SelectedProject | undefined {
    return this.project;
  }

  async getChildren(): Promise<MemberDesc[]> {
    if (!this.project) return [];
    const items: MemberItem[] = [];
    for (const repo of discoverRepos()) {
      if (!repo.enabled || repo.worktreeOf) continue;
      const store = new ThinkubeStore(repo.path, repo.boardDir);
      try {
        for (const t of await store.listTeps()) {
          const tags = effectiveTags(
            (await store.getFile(t.relativePath))?.frontmatter,
          );
          if (tags.length)
            items.push({ board: repo.name, handle: `TEP-${t.id}`, kind: "tep", tags });
        }
        for (const spec of await store.listSpecDirs()) {
          const tags = effectiveTags(
            (await store.getFile(store.pathForSpecDoc(spec)))?.frontmatter,
          );
          if (tags.length)
            items.push({ board: repo.name, handle: `SP-${spec}`, kind: "spec", tags });
        }
        for (const rel of await store.listSlices()) {
          const m = SLICE_RE.exec(rel);
          if (!m) continue;
          const tags = effectiveTags((await store.getFile(rel))?.frontmatter);
          if (tags.length)
            items.push({
              board: repo.name,
              handle: `SP-${m[1]}_SL-${m[2]}`,
              kind: "slice",
              tags,
            });
        }
      } catch {
        // skip an unreadable board
      }
    }
    return projectMembers(this.project.tag, items);
  }

  getTreeItem(node: MemberDesc): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.handle,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = `${node.kind} · ${node.board}`;
    item.tooltip = `${node.handle} (${node.kind}) — ${node.board}`;
    item.iconPath = new vscode.ThemeIcon(
      node.kind === "tep"
        ? "lightbulb"
        : node.kind === "spec"
          ? "list-tree"
          : "checklist",
    );
    return item;
  }
}
