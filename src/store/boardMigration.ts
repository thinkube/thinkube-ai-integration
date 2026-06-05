/**
 * boardMigration — move a Thinking Space's co-located `.thinkube/` board into
 * the central sidecar at its namespace dir (SP-8 / ADR-0008).
 *
 * Pure fs (no `vscode`) so it's unit-testable; the command layer
 * (`commands/boards.ts`) wraps it with the namespace resolution + UI. The move
 * is **no-loss** (every file carried over), **no-stub** (the source
 * `.thinkube/` is fully removed), and **non-destructive** (refuses when the
 * target already holds a board).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface MigrationResult {
  /** Number of files moved (for a no-loss report). */
  files: number;
}

/** Recursively count files under a dir. */
async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += await countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

/** Recursively copy `from` → `to` (dirs created as needed; symlinks preserved). */
async function copyTree(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) await copyTree(src, dst);
    else if (e.isSymbolicLink()) await fs.symlink(await fs.readlink(src), dst);
    else await fs.copyFile(src, dst);
  }
}

/**
 * Move the board dir `fromDir` (a repo's co-located `.thinkube/`) to `toDir`
 * (its central namespace dir). Refuses when `toDir` already exists and is
 * non-empty (no silent overwrite). Tries an atomic rename, falling back to
 * copy+remove across filesystems (EXDEV). Removes `fromDir` on success — no
 * stub left behind.
 */
export async function migrateBoardDir(
  fromDir: string,
  toDir: string,
): Promise<MigrationResult> {
  const from = path.resolve(fromDir);
  const to = path.resolve(toDir);
  if (from === to) {
    throw new Error(
      "Source and target are the same directory — nothing to migrate.",
    );
  }
  const fromStat = await fs.stat(from).catch(() => undefined);
  if (!fromStat?.isDirectory()) {
    throw new Error(`No board to migrate at ${from}.`);
  }
  const existing = await fs.readdir(to).catch(() => []);
  if (existing.length > 0) {
    throw new Error(
      `Target ${to} already exists and is not empty — refusing to overwrite.`,
    );
  }

  const files = await countFiles(from);
  await fs.mkdir(path.dirname(to), { recursive: true });
  // Drop an empty target dir (if present) so the rename creates it cleanly.
  await fs.rmdir(to).catch(() => {});
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      await copyTree(from, to);
      await fs.rm(from, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  return { files };
}
