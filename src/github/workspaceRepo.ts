/**
 * Methodology-root resolution.
 *
 * The methodology files (`.thinkube/`, `CLAUDE.md`, `.claude/`, `.mcp.json`)
 * live inside the git repository that backs the kanban. Rather than guess which
 * open folder that is, the user picks the folder explicitly via Configure
 * Project, and we derive the repo/board from its git remote. The chosen path is
 * persisted to `thinkube.kanban.folder`.
 *
 * Everything that touches those files — the `.thinkube` store, the bundle
 * installer, the MCP server's workspace env — resolves through here. There is
 * deliberately NO fallback to `workspaceFolders[0]`: if the folder isn't
 * configured we throw, so a misconfiguration fails loudly instead of silently
 * writing methodology files into an unrelated folder.
 */
import { promises as fs } from "node:fs";
import * as vscode from "vscode";

import { detectRepoCoords, RepoCoords } from "./gitRemote";

/**
 * The configured methodology root (absolute path), or throw. Pure config read —
 * cheap enough to call from activation and every command.
 */
export function getMethodologyRoot(): string {
  const folder = (
    vscode.workspace
      .getConfiguration("thinkube.kanban")
      .get<string>("folder") ?? ""
  ).trim();
  if (!folder) {
    throw new Error(
      'No methodology folder configured — run "Thinkube Kanban: Configure Project" and pick the repository folder.',
    );
  }
  return folder;
}

/** Like {@link getMethodologyRoot} but returns undefined instead of throwing. */
export function getMethodologyRootOrUndefined(): string | undefined {
  try {
    return getMethodologyRoot();
  } catch {
    return undefined;
  }
}

/**
 * Resolve the GitHub coords for the configured folder from its git remote.
 * Throws if the folder isn't configured, isn't a git repo, or has no GitHub
 * remote — never falls back to a default.
 */
export async function resolveConfiguredRepo(): Promise<{
  root: string;
  coords: RepoCoords;
}> {
  const root = getMethodologyRoot();
  const coords = await detectRepoCoords(root);
  if (!coords) {
    throw new Error(
      `Folder "${root}" is not a git repository with a github.com remote — methodology files can't be linked to a repo.`,
    );
  }
  return { root, coords };
}

/**
 * Candidate folders for the Configure Project picker: every open workspace
 * folder, each annotated with the GitHub repo detected from its git remote (or
 * a reason it can't be used). The picker also offers a "Browse…" entry for
 * repos that aren't open as workspace folders (e.g. a nested sub-repo).
 */
export async function listCandidateFolders(): Promise<
  Array<{ name: string; fsPath: string; coords?: RepoCoords }>
> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const out: Array<{ name: string; fsPath: string; coords?: RepoCoords }> = [];
  for (const f of folders) {
    const coords = await detectRepoCoords(f.uri.fsPath);
    out.push({ name: f.name, fsPath: f.uri.fsPath, coords });
  }
  return out;
}

/** True if `p` exists and is a directory. */
export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}
