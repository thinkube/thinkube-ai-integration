/**
 * Unit tests for the closing-gate regression primitives (SP-6/18, TEP-6) — the pure, injectable
 * `resolveRegressionCommand` / `regressionGateVerdict` / `applyRegressionGate`. node:test +
 * node:assert; run via the repo's self-verify.
 *
 * Pins the contract's decisions over synthetic inputs — no disk, no model:
 *   1. command resolution priority — declared conventions command wins; else `npm test` iff a
 *      non-empty `scripts.test`; else undefined; malformed package.json ⇒ undefined (no throw).
 *   2. verdict pass/fail/no-command — exit 0 ⇒ pass; non-zero ⇒ fail (command + tail + tokens);
 *      undefined run ⇒ no-command.
 *   3. fail-closed uniform block — a fail blocks EVERY landed slice with the shared diagnosis; pass
 *      ran-but-empty; no-command did-not-run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveRegressionCommand,
  regressionGateVerdict,
  applyRegressionGate,
  type RegressionVerdict,
} from "./regressionGate";

test("resolveRegressionCommand: the declared conventions command wins (trimmed)", () => {
  const cmd = resolveRegressionCommand({
    conventionsCommand: "  npm run compile && node --test out-test/  ",
    packageJsonText: `{"scripts":{"test":"jest"}}`,
  });
  assert.equal(cmd, "npm run compile && node --test out-test/");
});

test("resolveRegressionCommand: falls back to `npm test` for a non-empty scripts.test", () => {
  const cmd = resolveRegressionCommand({
    packageJsonText: `{"scripts":{"test":"node ./dist/test/runTest.js"}}`,
  });
  assert.equal(cmd, "npm test");
});

test("resolveRegressionCommand: no declaration and no test script ⇒ undefined", () => {
  assert.equal(resolveRegressionCommand({}), undefined);
  assert.equal(
    resolveRegressionCommand({
      packageJsonText: `{"scripts":{"build":"tsc"}}`,
    }),
    undefined,
  );
  assert.equal(
    resolveRegressionCommand({ packageJsonText: `{"scripts":{"test":"   "}}` }),
    undefined,
    "an empty/whitespace test script is not a whole-suite command",
  );
  // A blank declared command falls through to the package.json branch.
  assert.equal(
    resolveRegressionCommand({
      conventionsCommand: "   ",
      packageJsonText: `{"scripts":{"test":"jest"}}`,
    }),
    "npm test",
  );
});

test("resolveRegressionCommand: a malformed package.json is swallowed to undefined (no throw)", () => {
  assert.doesNotThrow(() =>
    resolveRegressionCommand({ packageJsonText: "{ not json" }),
  );
  assert.equal(
    resolveRegressionCommand({ packageJsonText: "{ not json" }),
    undefined,
  );
});

test("regressionGateVerdict: undefined run ⇒ no-command; exit 0 ⇒ pass", () => {
  assert.deepEqual(regressionGateVerdict(undefined), { status: "no-command" });
  assert.deepEqual(
    regressionGateVerdict({ command: "npm test", code: 0, output: "ok" }),
    { status: "pass" },
  );
});

test("regressionGateVerdict: a non-zero exit ⇒ fail with command, output tail, and pinned tokens", () => {
  const verdict = regressionGateVerdict({
    command: "npm test",
    code: 1,
    output:
      "FAIL src/services/orchestratorCore.test.ts\n  expected Grep to be denied\n",
  });
  assert.equal(verdict.status, "fail");
  if (verdict.status !== "fail") return;
  assert.match(verdict.diagnosis, /npm test/, "reproduces the command");
  assert.match(
    verdict.diagnosis,
    /orchestratorCore\.test\.ts/,
    "tails the output",
  );
  assert.match(verdict.diagnosis, /regression/, "pins the `regression` token");
  assert.match(
    verdict.diagnosis,
    /fail-closed/,
    "pins the `fail-closed` token",
  );
});

test("regressionGateVerdict: a long output is tailed, not reproduced whole", () => {
  const output = "x".repeat(10_000) + "TAILMARKER";
  const verdict = regressionGateVerdict({
    command: "npm test",
    code: 2,
    output,
  });
  assert.equal(verdict.status, "fail");
  if (verdict.status !== "fail") return;
  assert.match(verdict.diagnosis, /TAILMARKER/, "keeps the tail");
  assert.ok(
    verdict.diagnosis.length < output.length,
    "does not reproduce the whole output",
  );
});

test("applyRegressionGate: a fail blocks EVERY landed slice with the shared diagnosis (order-preserving)", () => {
  const verdict: RegressionVerdict = {
    status: "fail",
    diagnosis: "regression fail-closed: suite red",
  };
  const decision = applyRegressionGate({
    verdict,
    landedSlices: ["TEP-6_SP-18_SL-1", "TEP-6_SP-18_SL-2"],
  });
  assert.equal(decision.ran, true);
  assert.deepEqual(decision.blocked, [
    {
      slice: "TEP-6_SP-18_SL-1",
      diagnosis: "regression fail-closed: suite red",
    },
    {
      slice: "TEP-6_SP-18_SL-2",
      diagnosis: "regression fail-closed: suite red",
    },
  ]);
});

test("applyRegressionGate: pass ran-but-empty; no-command did-not-run", () => {
  assert.deepEqual(
    applyRegressionGate({
      verdict: { status: "pass" },
      landedSlices: ["TEP-6_SP-18_SL-1"],
    }),
    { ran: true, blocked: [] },
  );
  assert.deepEqual(
    applyRegressionGate({
      verdict: { status: "no-command" },
      landedSlices: ["TEP-6_SP-18_SL-1"],
    }),
    { ran: false, blocked: [] },
  );
});
