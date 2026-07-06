// Closing-gate full-suite regression backstop (SP-6/18, TEP-6).
//
// The author-time gate (`testImpactFootprint.ts`) catches an *importing* test at authoring time so a
// worker fixes it in scope — but it is import-only: it cannot see a *behavioural* break or a red that
// already sits in the tree (SP-6/16 restored `Grep` for test workers but left an SP-6/7 unit-test
// assertion stale, and it stayed red through every spec since because no stage ran the whole suite).
//
// This module is the pure core of the DETECTION half: after the closing gate's per-AC grade builds
// its green-eligible set, the orchestrator resolves the repo's declared WHOLE-SUITE command, runs it
// in the assembled worktree, and — on a red suite — FAILS CLOSED, forcing every green-eligible landed
// slice to requires-attention. No change reaches Done over a red tree.
//
// It is self-graded ON PURPOSE (`regression ≠ acceptance`): it asks "did anything else break", not
// "did the worker prove intent" — independence stays the acceptance grade's job (held-out per-AC
// probes, untouched). Repo-agnostic: the command comes from the repo's declared conventions
// (`.tandem/conventions.json` `selfVerify`) or a `package.json` `test` script, so the same gate works
// against a Python/Rust/Ansible repo; a repo with no whole-suite command is `no-command` (skipped,
// nothing to regress), mirroring the `prepare` build gate's "nothing declared ⇒ nothing runs".
//
// Pure / total / deterministic — no disk, no `vscode`, no model. The `OrchestratorService` wiring
// supplies the completed run (via an injectable `runRegression` seam) and turns the verdict into the
// requires-attention flags; every DECISION lives here.

/** A completed whole-suite run: the command executed, its exit code, and captured output. */
export interface RegressionRun {
  command: string;
  code: number;
  output: string;
}

/** The gate's read of a run: green, no command to run, or a red suite with a fail-closed diagnosis. */
export type RegressionVerdict =
  | { status: "pass" }
  | { status: "no-command" }
  | { status: "fail"; diagnosis: string };

/** A landed slice the fail-closed backstop blocks, with the shared regression diagnosis. */
export interface BlockedSlice {
  slice: string;
  diagnosis: string;
}

/** The backstop's decision: whether it ran and which landed slices it blocks (order-preserving). */
export interface RegressionGateDecision {
  ran: boolean;
  blocked: BlockedSlice[];
}

/** How many trailing chars of a red suite's output the diagnosis reproduces. */
const OUTPUT_TAIL = 4000;

/**
 * Resolve the repo's whole-suite regression command by declaration priority: the declared conventions
 * command (`.tandem/conventions.json` `selfVerify`, trimmed) wins; else `npm test` when the worktree's
 * `package.json` has a non-empty `scripts.test`; else `undefined` (nothing declared ⇒ nothing runs).
 * A malformed `package.json` is swallowed to `undefined` — the resolver never throws.
 */
export function resolveRegressionCommand(input: {
  conventionsCommand?: string;
  packageJsonText?: string;
}): string | undefined {
  const declared = input.conventionsCommand?.trim();
  if (declared) return declared;
  if (input.packageJsonText) {
    try {
      const pkg = JSON.parse(input.packageJsonText) as {
        scripts?: { test?: unknown };
      };
      const t = pkg?.scripts?.test;
      if (typeof t === "string" && t.trim() !== "") return "npm test";
    } catch {
      // Malformed package.json ⇒ no command (never throw — the gate degrades to no-command).
    }
  }
  return undefined;
}

/**
 * Map a completed run to a verdict. `undefined` run (no command resolved) ⇒ `no-command`; exit 0 ⇒
 * `pass`; any non-zero exit ⇒ `fail` with a diagnosis that reproduces the command, tails the last
 * ~4 000 chars of output, and pins the `regression` + `fail-closed` tokens the wiring surfaces.
 */
export function regressionGateVerdict(
  run: RegressionRun | undefined,
): RegressionVerdict {
  if (!run) return { status: "no-command" };
  if (run.code === 0) return { status: "pass" };
  const tail = run.output.slice(-OUTPUT_TAIL);
  const diagnosis =
    `Whole-suite regression gate FAILED (fail-closed): the repo's declared suite exited ` +
    `${run.code} on the assembled worktree, so a regression reached the tree and every ` +
    `green-eligible landed slice is blocked — no change reaches Done over a red tree.\n` +
    `$ ${run.command}\n${tail}`;
  return { status: "fail", diagnosis };
}

/**
 * Apply the verdict to the green-eligible landed slices, fail-closed. `fail` ⇒ block EVERY landed
 * slice with the shared diagnosis (`ran: true`); `pass` ⇒ ran, nothing blocked; `no-command` ⇒ did
 * not run, nothing blocked. Order-preserving over `landedSlices`. Pure — the caller performs the
 * flag/removal side-effects.
 */
export function applyRegressionGate(input: {
  verdict: RegressionVerdict;
  landedSlices: string[];
}): RegressionGateDecision {
  const { verdict, landedSlices } = input;
  if (verdict.status === "no-command") return { ran: false, blocked: [] };
  if (verdict.status === "pass") return { ran: true, blocked: [] };
  return {
    ran: true,
    blocked: landedSlices.map((slice) => ({
      slice,
      diagnosis: verdict.diagnosis,
    })),
  };
}
