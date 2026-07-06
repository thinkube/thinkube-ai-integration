/**
 * SP-6/18 (TEP-6) AC2 — the author-time test-impact REFUSAL is kind-appropriate.
 *
 * AC1's detector (`findUncoveredTests`) says *which* existing tests are in the
 * change's blast radius; THIS AC's builder turns that violation set into the
 * message the `create_slice`/`update_slice` gate throws — and the message's
 * remedy is NOT uniform: a `"unit"` test is folded into the slice's footprint
 * (the code-author updates it), whereas a `"held-out"` acceptance probe must
 * NEVER be pulled into a code-author's footprint (that would let the implementer
 * edit the very probe that grades them — TEP-6 mechanism 5); its remedy is to
 * retire it in a deletion unit or reconsider the change.
 *
 * Exercised against the ONE public surface the SPEC CONTRACT names for this AC —
 * `buildTestImpactRefusal(violations)` — and nothing about its internals. The
 * builder is a pure, seam-free string function (no disk, no board, no model), so
 * these are the load-bearing AC2 assertions.
 *
 * Contract pins:
 *   - one line per violation, joined by "\n";
 *   - the whole message is TRIMMED — no leading/trailing whitespace, no blank
 *     first/last line, no trailing newline (the caller owns surrounding layout);
 *   - a `"unit"` line names the test + changed file and CONTAINS the token
 *     `footprint` (add-to-footprint);
 *   - a `"held-out"` line names the test + changed file, CONTAINS the token
 *     `retire`, and CONTAINS NO `footprint` (never added to a code footprint);
 *   - an empty violation set yields the empty string.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildTestImpactRefusal,
  type TestImpactViolation,
} from "../services/testImpactFootprint";

// ── the controlled violation fixtures ────────────────────────────────────────
// A held-out acceptance probe under src/acceptance/, and a unit test elsewhere —
// both importing a changed source file. These are the two `kind`s the builder
// must render differently.
const HELD_OUT: TestImpactViolation = {
  test: "src/acceptance/SP-6_7_AC-1.test.ts",
  changed: "src/services/orchestratorCore.ts",
  kind: "held-out",
};
const UNIT: TestImpactViolation = {
  test: "src/services/regressionGate.test.ts",
  changed: "src/services/regressionGate.ts",
  kind: "unit",
};

// ── empty set ⇒ empty string ─────────────────────────────────────────────────

test("AC2: an empty violation set yields the empty string (no message)", () => {
  assert.equal(buildTestImpactRefusal([]), "");
});

// ── a unit violation: names test + changed, directs footprint ────────────────

test("AC2: a `unit` violation renders ONE line that names the test + changed file and directs adding to the footprint", () => {
  const msg = buildTestImpactRefusal([UNIT]);

  // Exactly one line for one violation.
  assert.equal(msg.split("\n").length, 1, "one line per violation");
  // Names both the importing test and the changed file it imports.
  assert.match(msg, new RegExp(UNIT.test.replace(/[.]/g, "\\.")));
  assert.match(msg, new RegExp(UNIT.changed.replace(/[.]/g, "\\.")));
  // The unit remedy: fold it into the slice's footprint (pinned token).
  assert.match(
    msg,
    /footprint/,
    "a unit violation directs adding to the footprint",
  );
});

// ── a held-out violation: names test + changed, directs retire, NO footprint ──

test("AC2: a `held-out` violation renders ONE line that directs RETIRE and never directs adding to a footprint", () => {
  const msg = buildTestImpactRefusal([HELD_OUT]);

  assert.equal(msg.split("\n").length, 1, "one line per violation");
  assert.match(msg, new RegExp(HELD_OUT.test.replace(/[.]/g, "\\.")));
  assert.match(msg, new RegExp(HELD_OUT.changed.replace(/[.]/g, "\\.")));
  // The held-out remedy: retire it / reconsider the change (pinned token) …
  assert.match(
    msg,
    /retire/,
    "a held-out violation directs retiring the probe",
  );
  // … and CRUCIALLY it must NOT tell a code-author to footprint the probe
  // (TEP-6 mechanism 5 — the implementer must never own the probe that grades it).
  assert.doesNotMatch(
    msg,
    /footprint/,
    "a held-out probe is never added to a code footprint",
  );
});

// ── kind-appropriateness across a mixed set: one line each, right token each ──

test("AC2: a mixed set renders exactly one kind-appropriate line per violation", () => {
  const violations: TestImpactViolation[] = [UNIT, HELD_OUT];
  const msg = buildTestImpactRefusal(violations);

  const lines = msg.split("\n");
  assert.equal(
    lines.length,
    violations.length,
    "one line per violation — no more, no fewer",
  );

  // The unit line carries `footprint`; the held-out line carries `retire` and no
  // `footprint`. Find each by the test path it must name.
  const unitLine = lines.find((l) => l.includes(UNIT.test));
  const heldLine = lines.find((l) => l.includes(HELD_OUT.test));
  assert.ok(unitLine, "the unit violation gets its own line");
  assert.ok(heldLine, "the held-out violation gets its own line");

  assert.match(unitLine!, /footprint/, "unit line → footprint token");
  assert.match(heldLine!, /retire/, "held-out line → retire token");
  assert.doesNotMatch(
    heldLine!,
    /footprint/,
    "held-out line has no footprint directive",
  );

  // Every line names both its test and its changed file.
  assert.ok(unitLine!.includes(UNIT.changed));
  assert.ok(heldLine!.includes(HELD_OUT.changed));
});

// ── layout: trimmed — no leading/trailing whitespace, no blank first/last line ─

test("AC2: the message is flush-left and TRIMMED (no leading/trailing whitespace, no trailing newline)", () => {
  const msg = buildTestImpactRefusal([UNIT, HELD_OUT]);

  // The whole message equals its own trim — no leading/trailing whitespace at all.
  assert.equal(msg, msg.trim(), "the whole message is trimmed");
  // Explicitly: no leading blank line / first-line indentation …
  assert.doesNotMatch(msg, /^\s/, "no leading whitespace on the first line");
  // … and no trailing newline / blank last line.
  assert.doesNotMatch(msg, /\s$/, "no trailing whitespace or newline");
  // No empty lines between violations (one line per violation, joined by \n).
  assert.ok(
    msg.split("\n").every((l) => l.trim() !== ""),
    "no blank lines within the message",
  );
});

// ── a single-violation message carries no surrounding whitespace either ───────

test("AC2: even a single-violation message owns no surrounding layout (caller owns it)", () => {
  for (const v of [UNIT, HELD_OUT]) {
    const msg = buildTestImpactRefusal([v]);
    assert.equal(msg, msg.trim());
    assert.equal(msg.split("\n").length, 1);
    assert.notEqual(
      msg,
      "",
      "a non-empty violation set yields a non-empty message",
    );
  }
});
