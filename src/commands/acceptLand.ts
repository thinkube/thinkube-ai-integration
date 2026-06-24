/**
 * The cleanup half of accept-land (TEP-tgqa78), shared by both accept entry
 * points — `thinkube.accept` (the delivery-report surface, `orchestrate.ts`) and
 * `onAcceptSpec` (the kanban panel button, `boards.ts`). The merge half lives in
 * `github/specMerge.ts`; this retires the Spec's worktree afterwards.
 *
 * The `acceptLandSpec` dispatcher below ties the two halves together through the
 * pure `acceptOrder` driver (SP-th4wqe, #10-residual), so both call sites get one
 * audited merge → stamp → retire ordering with idempotent, best-effort retire
 * instead of each re-deriving it inline.
 */
import * as vscode from "vscode";

import { mergeSpecPr, SpecMergeResult } from "../github/specMerge";
import { acceptOrder } from "../services/acceptOrder";
import { WorktreeService } from "../services/WorktreeService";

/**
 * Retire the Spec's worktree after its merge succeeded and return a short note for
 * the accept toast. **Best-effort**: a retire failure is reported in the note, never
 * thrown — the Spec is already merged and stamped, so cleanup must not turn a
 * successful accept into an error. Defers (leaves the worktree) when the accept
 * fires from inside the very worktree being retired, so it never deletes the
 * session's own cwd.
 */
export async function retireWorktreeNote(
  worktrees: WorktreeService,
  repoPath: string,
  specId: string,
): Promise<string> {
  try {
    const canonical = (await worktrees.canonicalRepo(repoPath)) ?? repoPath;
    const here = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const outcome = await worktrees.retireAfterAccept(canonical, specId, here);
    return outcome === "retired"
      ? " Worktree retired."
      : outcome === "deferred"
        ? " (Worktree left in place — you're working in it; retire it later.)"
        : "";
  } catch (e) {
    return ` (Worktree retire failed: ${(e as Error).message})`;
  }
}

/** What `acceptLandSpec` needs to land one accepted Spec. */
export interface AcceptLandArgs {
  /** Bare Spec id (no `SP-` prefix), e.g. `th4wqe`. */
  specId: string;
  /** Repo / workspace root the merge + retire run against. */
  repoPath: string;
  /** The worktree service used to retire the Spec's worktree. */
  worktrees: WorktreeService;
  /**
   * Stamp `accepted:` on the Spec doc. Call-site specific (it owns the store +
   * frontmatter), so it is injected. Runs after the merge call returns — never
   * before — so a stamped Spec is always a landed one.
   */
  stamp: (merge: SpecMergeResult) => Promise<void>;
  /**
   * Land the Spec's branch. Defaults to `mergeSpecPr(specId, repoPath)`; injectable
   * so callers (and tests) can substitute the real `gh`/`git` driver.
   */
  merge?: () => Promise<SpecMergeResult>;
}

/** The outcome of an `acceptLandSpec` dispatch, shaped for the accept toast. */
export interface AcceptLandResult {
  /** The resolved merge outcome (merged / already-merged / benign no-PR). */
  merge: SpecMergeResult;
  /**
   * Toast-ready retire note — `" Worktree retired."`, the deferred/failed note, or
   * `""` when nothing landed (no worktree to retire).
   */
  retireNote: string;
}

/**
 * Dispatch a Spec accept through the pure `acceptOrder` driver: merge the Spec's PR
 * (`specMerge`), stamp `accepted:` (caller-injected), then retire the worktree
 * (`retireWorktreeNote`) — in that order, with retire running **only when something
 * landed** and **best-effort** so a cleanup failure (including an already-merged /
 * branch-gone Spec whose worktree is already gone) never turns a landed, stamped
 * accept into an error. This is the single seam both accept call sites
 * (`boards.ts` / `orchestrate.ts`) route through.
 */
export async function acceptLandSpec(
  args: AcceptLandArgs,
): Promise<AcceptLandResult> {
  const result = await acceptOrder<SpecMergeResult, string>({
    merge: args.merge ?? (() => mergeSpecPr(args.specId, args.repoPath)),
    stamp: args.stamp,
    retire: () =>
      retireWorktreeNote(args.worktrees, args.repoPath, args.specId),
  });

  // `retireWorktreeNote` is itself best-effort (it folds failures into the note and
  // never throws), so in practice `result.retire` holds the note. `retireError` is
  // honoured defensively in case a future retire step throws instead.
  const retireNote =
    result.retire ??
    (result.retireError
      ? ` (Worktree retire failed: ${result.retireError.message})`
      : "");

  return { merge: result.merge, retireNote };
}
