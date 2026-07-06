/**
 * SP-6/18 (TEP-6) AC4 — the fail-closed, UNIFORM closing-gate application.
 *
 * The closing gate's whole-suite regression backstop is only a backstop if its
 * decision is uniform and fail-closed: one red suite must force EVERY
 * green-eligible landed slice back to requires-attention — no slice may reach
 * Done over a red tree — while a green (or absent) suite blocks nothing. This AC
 * pins the pure decision core `applyRegressionGate({ verdict, landedSlices })`
 * that the `OrchestratorService` closing gate routes its verdict through after
 * the per-AC grade:
 *
 *   - fail       ⇒ block EVERY landed slice, each carrying the verdict's SHARED
 *                  diagnosis, and report ran=true.
 *   - pass       ⇒ block nothing, ran=true.
 *   - no-command ⇒ block nothing, ran=false (the suite never ran).
 *
 * The probe exercises ONLY the public `applyRegressionGate` interface named in
 * the SPEC CONTRACT. It constructs `RegressionVerdict` values directly from the
 * contract's union shape — it makes NO assumption about how a verdict is produced
 * (`regressionGateVerdict` is AC3's own coverage) nor about any internal wiring;
 * the pure application is what's on trial. Every assertion pins a load-bearing
 * fact of the contract — uniformity, the shared diagnosis, order preservation,
 * the ran flag, and totality/purity — not incidental wording.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyRegressionGate,
  type RegressionVerdict,
  type RegressionGateDecision,
} from "../services/regressionGate";

// A realistic set of landed, green-eligible slices — the commit set the closing
// gate has assembled after the per-AC grade. Order is meaningful: the contract
// pins the decision as order-preserving.
const LANDED = ["TEP-6_SP-18_SL-1", "TEP-6_SP-9_SL-2", "TEP-6_SP-16_SL-3"];

// A concrete fail diagnosis — an opaque string produced upstream (AC3). The point
// here is that this EXACT string is the shared block reason on every slice.
const DIAGNOSIS =
  "regression suite fail-closed: `npm test` exited 1\n… 3 failing, 0 passing …";

const failVerdict = (diagnosis = DIAGNOSIS): RegressionVerdict => ({
  status: "fail",
  diagnosis,
});
const passVerdict: RegressionVerdict = { status: "pass" };
const noCommandVerdict: RegressionVerdict = { status: "no-command" };

// ── fail ⇒ EVERY landed slice blocked, each with the SHARED diagnosis, ran=true ──

test("AC4: a fail verdict blocks EVERY landed slice — none skipped — and ran=true", () => {
  const decision = applyRegressionGate({
    verdict: failVerdict(),
    landedSlices: LANDED,
  });

  assert.equal(decision.ran, true, "the suite ran (a fail is a completed run)");

  // Uniform: one blocked entry per landed slice, no more, no fewer.
  assert.equal(
    decision.blocked.length,
    LANDED.length,
    "a red suite must block every green-eligible landed slice — no slice reaches Done over a red tree",
  );

  // EVERY landed slice is represented — the set of blocked slices equals the set
  // of landed slices (fail-closed: nothing is exempt).
  assert.deepEqual(
    decision.blocked.map((b) => b.slice),
    LANDED,
    "every landed slice must be blocked, in the SAME order (order-preserving, uniform)",
  );
});

test("AC4: on fail, every blocked slice carries the verdict's SHARED diagnosis verbatim", () => {
  const decision = applyRegressionGate({
    verdict: failVerdict(),
    landedSlices: LANDED,
  });

  for (const blocked of decision.blocked) {
    assert.equal(
      blocked.diagnosis,
      DIAGNOSIS,
      `slice ${blocked.slice} must be blocked with the verdict's shared diagnosis, byte-for-byte`,
    );
  }

  // "shared" made explicit: one distinct diagnosis across all blocked slices.
  const distinct = new Set(decision.blocked.map((b) => b.diagnosis));
  assert.equal(
    distinct.size,
    1,
    "the diagnosis is shared — every blocked slice cites the one same reason",
  );
});

test("AC4: the shared diagnosis ECHOES the verdict (it is not a hardcoded string)", () => {
  const custom = "regression fail-closed: `pytest` exited 2 — collection error";
  const decision = applyRegressionGate({
    verdict: failVerdict(custom),
    landedSlices: ["TEP-6_SP-18_SL-1"],
  });
  assert.equal(
    decision.blocked[0]?.diagnosis,
    custom,
    "the block reason is the verdict's own diagnosis — echoed, not fabricated",
  );
});

// ── pass ⇒ block nothing, ran=true ────────────────────────────────────────────

test("AC4: a pass verdict blocks nothing and reports ran=true", () => {
  const decision = applyRegressionGate({
    verdict: passVerdict,
    landedSlices: LANDED,
  });
  assert.equal(
    decision.ran,
    true,
    "a green suite is a completed run: ran=true",
  );
  assert.deepEqual(
    decision.blocked,
    [],
    "a green suite blocks nothing — every landed slice may advance",
  );
});

// ── no-command ⇒ block nothing, ran=false ─────────────────────────────────────

test("AC4: a no-command verdict blocks nothing and reports ran=false (the suite never ran)", () => {
  const decision = applyRegressionGate({
    verdict: noCommandVerdict,
    landedSlices: LANDED,
  });
  assert.equal(
    decision.ran,
    false,
    "no whole-suite command was declared: the suite never ran (ran=false), mirroring the prepare gate's 'nothing declared ⇒ nothing runs'",
  );
  assert.deepEqual(
    decision.blocked,
    [],
    "with nothing to regress, no landed slice is blocked",
  );
});

// The pass and no-command outcomes agree on the block set but DISAGREE on `ran` —
// the flag is the only thing distinguishing "ran and passed" from "never ran".
test("AC4: pass and no-command both block nothing but are distinguished by the ran flag", () => {
  const passed = applyRegressionGate({
    verdict: passVerdict,
    landedSlices: LANDED,
  });
  const skipped = applyRegressionGate({
    verdict: noCommandVerdict,
    landedSlices: LANDED,
  });
  assert.deepEqual(passed.blocked, []);
  assert.deepEqual(skipped.blocked, []);
  assert.notEqual(
    passed.ran,
    skipped.ran,
    "ran must separate a passed suite (true) from an unrun/absent one (false)",
  );
});

// ── totality / edge: an empty landed set is total on every verdict ────────────

test("AC4: an empty landed set yields no blocks on any verdict — ran still reflects the verdict", () => {
  const onFail = applyRegressionGate({
    verdict: failVerdict(),
    landedSlices: [],
  });
  assert.deepEqual(
    onFail.blocked,
    [],
    "no landed slices ⇒ nothing to block, even on fail",
  );
  assert.equal(
    onFail.ran,
    true,
    "a fail is still a completed run regardless of the landed set",
  );

  const onPass = applyRegressionGate({
    verdict: passVerdict,
    landedSlices: [],
  });
  assert.deepEqual(onPass, {
    ran: true,
    blocked: [],
  } satisfies RegressionGateDecision);

  const onSkip = applyRegressionGate({
    verdict: noCommandVerdict,
    landedSlices: [],
  });
  assert.deepEqual(onSkip, {
    ran: false,
    blocked: [],
  } satisfies RegressionGateDecision);
});

// ── uniformity under scale + a single-slice case (no off-by-one on the boundary) ──

test("AC4: fail is uniform across a single slice and across many — the count always equals the landed count", () => {
  const one = applyRegressionGate({
    verdict: failVerdict(),
    landedSlices: ["TEP-6_SP-18_SL-1"],
  });
  assert.equal(one.blocked.length, 1);
  assert.equal(one.blocked[0]?.slice, "TEP-6_SP-18_SL-1");

  const many = ["a", "b", "c", "d", "e", "f"];
  const big = applyRegressionGate({
    verdict: failVerdict(),
    landedSlices: many,
  });
  assert.equal(
    big.blocked.length,
    many.length,
    "one blocked entry per landed slice, always",
  );
  assert.deepEqual(
    big.blocked.map((b) => b.slice),
    many,
    "order preserved at scale",
  );
});

// ── purity: deterministic, and the input is not mutated ───────────────────────

test("AC4: applyRegressionGate is pure — deterministic and non-mutating on its input", () => {
  const landed = [...LANDED];
  const input = { verdict: failVerdict(), landedSlices: landed };

  const a = applyRegressionGate(input);
  const b = applyRegressionGate(input);
  assert.deepEqual(a, b, "same input ⇒ same decision (deterministic)");

  // The caller's array is left untouched (the closing gate reuses the commit set).
  assert.deepEqual(
    landed,
    LANDED,
    "applyRegressionGate must not mutate the landedSlices array it was handed",
  );
});
