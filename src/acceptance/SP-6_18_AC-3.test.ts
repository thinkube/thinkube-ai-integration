/**
 * SP-6/18 (TEP-6) AC3 — the pure regression-command resolver + completed-run verdict.
 *
 * The closing-gate full-suite backstop rests on two pure, total, deterministic
 * primitives (no I/O, no `vscode`, no model), exercised here directly through the
 * public interface named in the SPEC CONTRACT — this probe makes NO assumption
 * about their internal implementation:
 *
 *   1. `resolveRegressionCommand({ conventionsCommand?, packageJsonText? })` picks
 *      the repo's WHOLE-SUITE command with a fixed PRIORITY and is TOTAL:
 *        (a) the declared conventions command, TRIMMED, wins outright;
 *        (b) else `npm test` when `package.json` declares a non-empty `scripts.test`;
 *        (c) else `undefined` — and a MALFORMED `package.json` yields `undefined`,
 *            never a throw (repo-agnostic: a repo with nothing declared is skipped).
 *
 *   2. `regressionGateVerdict(run)` grades a COMPLETED run:
 *        - `undefined`            ⇒ `{ status: "no-command" }` (nothing ran);
 *        - exit code `0`          ⇒ `{ status: "pass" }`;
 *        - any NON-ZERO exit      ⇒ `{ status: "fail", diagnosis }`, whose diagnosis
 *          REPRODUCES the command (an operator can re-run it), TAILS the suite
 *          output (the last of a long log survives; the head is dropped), and pins
 *          the fail-closed posture with the tokens `regression` + `fail-closed`.
 *
 * Assertions on the diagnosis are SUBSTRING/token checks (never exact-glyph
 * equality) so wording can evolve; only the load-bearing facts are pinned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveRegressionCommand,
  regressionGateVerdict,
  type RegressionRun,
  type RegressionVerdict,
} from "../services/regressionGate";

// ── resolveRegressionCommand — PRIORITY: the declared conventions command wins ──

test("SP-6/18 AC3 — the declared conventions command wins, trimmed, even when package.json declares a test script", () => {
  const cmd = resolveRegressionCommand({
    conventionsCommand:
      "  npm run compile && node --test out-test/**/*.test.js  ",
    packageJsonText: JSON.stringify({ scripts: { test: "vitest run" } }),
  });
  assert.equal(
    cmd,
    "npm run compile && node --test out-test/**/*.test.js",
    "the declared conventions command is preferred over the package.json test " +
      "script AND returned trimmed (leading/trailing whitespace stripped)",
  );
});

test("SP-6/18 AC3 — with NO conventions command, `npm test` is chosen when scripts.test is non-empty", () => {
  const cmd = resolveRegressionCommand({
    packageJsonText: JSON.stringify({ scripts: { test: "jest --ci" } }),
  });
  assert.equal(
    cmd,
    "npm test",
    "the whole-suite fallback is the canonical `npm test`, not the raw script body",
  );
});

test("SP-6/18 AC3 — a blank/whitespace-only conventions command does not win — it is not a runnable command", () => {
  const cmd = resolveRegressionCommand({
    conventionsCommand: "   ",
    packageJsonText: JSON.stringify({ scripts: { test: "mocha" } }),
  });
  assert.equal(
    cmd,
    "npm test",
    "a conventions command that trims to empty is treated as absent, so the " +
      "package.json test-script fallback applies (no empty command escapes)",
  );
});

// ── resolveRegressionCommand — TOTALITY: nothing declared / malformed ⇒ undefined ─

test("SP-6/18 AC3 — nothing declared at all ⇒ undefined (a repo with no whole-suite command is skippable)", () => {
  assert.equal(resolveRegressionCommand({}), undefined);
});

test("SP-6/18 AC3 — package.json with an EMPTY scripts.test ⇒ undefined (non-empty is required)", () => {
  assert.equal(
    resolveRegressionCommand({
      packageJsonText: JSON.stringify({ scripts: { test: "" } }),
    }),
    undefined,
    "an empty test script does not declare a runnable whole-suite command",
  );
});

test("SP-6/18 AC3 — package.json with scripts but no `test` key ⇒ undefined", () => {
  assert.equal(
    resolveRegressionCommand({
      packageJsonText: JSON.stringify({ scripts: { build: "tsc -p ./" } }),
    }),
    undefined,
  );
});

test("SP-6/18 AC3 — a MALFORMED package.json ⇒ undefined, never a throw (totality)", () => {
  let cmd: string | undefined;
  assert.doesNotThrow(() => {
    cmd = resolveRegressionCommand({ packageJsonText: "{ not valid json ]" });
  }, "parse errors must be swallowed — the resolver is total");
  assert.equal(cmd, undefined);
});

test("SP-6/18 AC3 — a declared conventions command wins even when package.json is malformed (priority before parse)", () => {
  assert.equal(
    resolveRegressionCommand({
      conventionsCommand: "cargo test",
      packageJsonText: "}{ broken",
    }),
    "cargo test",
    "the conventions command short-circuits before package.json is parsed",
  );
});

// ── regressionGateVerdict — no-command / pass ────────────────────────────────

test("SP-6/18 AC3 — an undefined run ⇒ no-command (nothing to regress)", () => {
  const v: RegressionVerdict = regressionGateVerdict(undefined);
  assert.deepEqual(v, { status: "no-command" });
});

test("SP-6/18 AC3 — a completed run with exit code 0 ⇒ pass", () => {
  const run: RegressionRun = {
    command: "npm test",
    code: 0,
    output: "42 passing\n0 failing\n",
  };
  const v = regressionGateVerdict(run);
  assert.deepEqual(v, { status: "pass" });
});

// ── regressionGateVerdict — fail: diagnosis reproduces command, tails output,
//    and pins the fail-closed posture ─────────────────────────────────────────

test("SP-6/18 AC3 — a non-zero exit ⇒ fail whose diagnosis reproduces the command AND pins the `regression` + `fail-closed` tokens", () => {
  const run: RegressionRun = {
    command: "npm run compile && node --test out-test/**/*.test.js",
    code: 1,
    output: "1 passing\n1 failing\n  AssertionError: expected 2 to equal 3\n",
  };
  const v = regressionGateVerdict(run);
  assert.equal(v.status, "fail");
  // The type-narrowed diagnosis (only present on a fail verdict).
  const diagnosis = (v as { status: "fail"; diagnosis: string }).diagnosis;
  assert.ok(
    diagnosis && diagnosis.length > 0,
    "a fail verdict carries a non-empty diagnosis",
  );
  // Reproduces the command so an operator can re-run the suite.
  assert.ok(
    diagnosis.includes(run.command),
    `the diagnosis must reproduce the whole-suite command (got: ${diagnosis})`,
  );
  // Pins the fail-closed posture with the two load-bearing tokens.
  assert.match(
    diagnosis,
    /regression/i,
    "the diagnosis names this as a regression failure",
  );
  assert.match(
    diagnosis,
    /fail-closed/i,
    "the diagnosis pins the fail-closed posture",
  );
});

test("SP-6/18 AC3 — the fail diagnosis TAILS the suite output — the end survives, a very long head is dropped", () => {
  // A log far larger than any reasonable tail window (~4 000 chars): a unique
  // marker at the very start and another at the very end. Tailing keeps the end
  // and drops the beginning.
  const HEAD = "HEAD_MARKER_should_be_dropped_when_tailed";
  const TAIL = "TAIL_MARKER_the_actual_failing_assertion";
  const filler = "x".repeat(20_000);
  const run: RegressionRun = {
    command: "npm test",
    code: 1,
    output: `${HEAD}\n${filler}\n${TAIL}`,
  };
  const v = regressionGateVerdict(run);
  assert.equal(v.status, "fail");
  const diagnosis = (v as { status: "fail"; diagnosis: string }).diagnosis;
  assert.ok(
    diagnosis.includes(TAIL),
    "the tail of the suite output (where the failure surfaces) must be retained",
  );
  assert.ok(
    !diagnosis.includes(HEAD),
    "a head 20k chars from the end must be dropped — the diagnosis TAILS, not embeds, the full log",
  );
});

test("SP-6/18 AC3 — any non-zero exit code fails (not only code 1)", () => {
  for (const code of [2, 137, 255, -1]) {
    const v = regressionGateVerdict({
      command: "pytest",
      code,
      output: "boom",
    });
    assert.equal(v.status, "fail", `exit code ${code} must be a fail`);
  }
});

test("SP-6/18 AC3 — a short output that is entirely within the tail window is reproduced in full", () => {
  const run: RegressionRun = {
    command: "cargo test",
    code: 101,
    output: "error[E0308]: mismatched types\n  --> src/lib.rs:10:5",
  };
  const v = regressionGateVerdict(run);
  assert.equal(v.status, "fail");
  const diagnosis = (v as { status: "fail"; diagnosis: string }).diagnosis;
  assert.ok(
    diagnosis.includes("error[E0308]: mismatched types"),
    "a short log fits wholly inside the tail window and survives verbatim",
  );
});
