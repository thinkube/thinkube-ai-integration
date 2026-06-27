/**
 * boardDetection — what counts as a Tandem board on disk (TEP-tghb9t / TEP-0008).
 *
 * A directory is a board iff it is **board-shaped**: its board dir contains a
 * `specs/` subdir. Enabling a board always scaffolds `specs/`, `decisions/`,
 * and `retros/` (`commands/boards.ts`), so every real board — sidecar
 * namespace or legacy co-located `<repo>/.thinkube` — has `specs/`. A directory
 * that merely happens to contain a `.thinkube/` for some other purpose (e.g.
 * an `api-token` store at `~/.thinkube`) is NOT a board.
 *
 * This is the guard that stops a stray `.thinkube/` from being mistaken for a
 * co-located board and adopted as the session default — the silent fallback
 * TEP-0008 set out to remove. Kept fs-only (no `vscode`, no server import) so
 * it is unit-testable without booting the MCP server.
 */
import * as fsSync from "node:fs";
import * as path from "node:path";

/** The methodology dirs that mark an *enabled* board (`enableHere` scaffolds
 *  `specs`/`decisions`/`retros`; `teps` arrives with the first TEP). Any one of
 *  them — flat (legacy) or under an `<org>/` segment (the org-scoped tree) —
 *  means this is a board, even one with no TEPs yet. */
const BOARD_MARKERS = ["teps", "specs", "decisions", "retros"];

/** True iff `boardDir` is board-shaped: a legacy flat methodology dir at its
 *  root, OR — under the org-scoped tree (TEP-th8lzj) — an immediate `<org>/`
 *  child that holds one (so an enabled-but-empty board still counts). */
export function isBoardDir(boardDir: string): boolean {
  const hasSubdir = (dir: string, name: string): boolean => {
    try {
      return fsSync.statSync(path.join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  };
  if (BOARD_MARKERS.some((m) => hasSubdir(boardDir, m))) return true;
  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(boardDir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules")
      continue;
    if (BOARD_MARKERS.some((m) => hasSubdir(path.join(boardDir, e.name), m)))
      return true;
  }
  return false;
}
