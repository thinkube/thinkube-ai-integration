/**
 * SP-6/14 (TEP-6) AC1 — a superseded spec is excluded from its TEP's backlog and
 * no longer blocks completeness.
 *
 * Pure decision-layer test (env: local, no fs / no vscode). Exercises ONLY the
 * public `tepLifecycle` surface named in the spec contract:
 *
 *   - `isSuperseded(spec)` — true iff `spec.superseded` is a non-empty trimmed
 *     string (the exact mirror of `isAccepted`).
 *   - `tepComplete(tepId, implementingSpecs)` —
 *       openSpecs = specs.filter(s => !isAccepted(s) && !isSuperseded(s)).map(id)
 *       complete  = specs.length > 0 && openSpecs.length === 0
 *
 * The AC in words: over a set of implementing specs where one is superseded and
 * not accepted, completeness EXCLUDES the superseded spec from `openSpecs`; and a
 * TEP whose specs are ALL accepted-or-superseded — including when EVERY spec is
 * superseded and NONE is accepted — reports `complete: true`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isSuperseded,
  tepComplete,
  type ImplementingSpec,
} from "../methodology/tepLifecycle";

const ISO = "2026-07-04T12:00:00.000Z";

/** Convenience builders that keep each spec's intent legible at the call site. */
const open = (id: string): ImplementingSpec => ({ id });
const accepted = (id: string): ImplementingSpec => ({ id, accepted: ISO });
const superseded = (id: string): ImplementingSpec => ({ id, superseded: ISO });

// ── isSuperseded: the exact mirror of isAccepted ─────────────────────────────

test("isSuperseded is true iff `superseded` is a non-empty trimmed string", () => {
  // Present, non-empty → superseded.
  assert.equal(isSuperseded({ id: "SP-1", superseded: ISO }), true);
  assert.equal(isSuperseded({ id: "SP-1", superseded: "x" }), true);

  // Absent / empty / whitespace-only → NOT superseded (mirrors isAccepted).
  assert.equal(isSuperseded({ id: "SP-1" }), false);
  assert.equal(isSuperseded({ id: "SP-1", superseded: "" }), false);
  assert.equal(isSuperseded({ id: "SP-1", superseded: "   " }), false);
});

test("isSuperseded is orthogonal to accepted — an accepted-but-not-superseded spec is not superseded", () => {
  assert.equal(isSuperseded({ id: "SP-1", accepted: ISO }), false);
  // Both stamps present → still superseded on the superseded axis.
  assert.equal(
    isSuperseded({ id: "SP-1", accepted: ISO, superseded: ISO }),
    true,
  );
});

// ── tepComplete: superseded excluded from openSpecs ──────────────────────────

test("a superseded (not accepted) spec is EXCLUDED from openSpecs and does not keep the TEP incomplete", () => {
  // One accepted, one superseded → nothing open → complete.
  const specs = [accepted("SP-a"), superseded("SP-b")];
  const result = tepComplete("TEP-6", specs);

  assert.deepEqual(
    result.openSpecs,
    [],
    "the superseded spec must not appear in openSpecs",
  );
  assert.equal(
    result.complete,
    true,
    "all specs resolved (accepted or superseded) ⇒ complete",
  );
});

test("openSpecs still lists genuinely-open specs while excluding the superseded one", () => {
  // Mix: one accepted, one superseded, two still open. Only the open ones remain.
  const specs = [
    accepted("SP-a"),
    superseded("SP-b"),
    open("SP-c"),
    open("SP-d"),
  ];
  const result = tepComplete("TEP-6", specs);

  assert.deepEqual(
    result.openSpecs,
    ["SP-c", "SP-d"],
    "only unaccepted-and-unsuperseded specs stay open, in input order",
  );
  assert.equal(
    result.complete,
    false,
    "remaining open specs keep the TEP incomplete",
  );
});

// ── tepComplete: all-accepted-or-superseded ⇒ complete ───────────────────────

test("a TEP whose specs are all accepted OR superseded reports complete", () => {
  const specs = [
    accepted("SP-a"),
    superseded("SP-b"),
    accepted("SP-c"),
    superseded("SP-d"),
  ];
  const result = tepComplete("TEP-6", specs);

  assert.deepEqual(result.openSpecs, []);
  assert.equal(result.complete, true);
});

test("EVERY spec superseded and NONE accepted ⇒ complete (the core of the AC)", () => {
  const specs = [superseded("SP-a"), superseded("SP-b"), superseded("SP-c")];
  const result = tepComplete("TEP-6", specs);

  assert.deepEqual(
    result.openSpecs,
    [],
    "an all-superseded TEP has no open specs",
  );
  assert.equal(
    result.complete,
    true,
    "all-superseded, zero-accepted still counts as complete — superseded is resolved",
  );
});

test("a single superseded spec is enough to complete a one-spec TEP", () => {
  const result = tepComplete("TEP-6", [superseded("SP-only")]);
  assert.deepEqual(result.openSpecs, []);
  assert.equal(result.complete, true);
});

// ── Guardrails: superseded doesn't over-reach ────────────────────────────────

test("an empty/whitespace superseded stamp does NOT resolve a spec — it stays open", () => {
  // A blank superseded field is not a supersede (mirrors blank accepted).
  const specs = [{ id: "SP-a", superseded: "   " }, superseded("SP-b")];
  const result = tepComplete("TEP-6", specs);

  assert.deepEqual(
    result.openSpecs,
    ["SP-a"],
    "a whitespace-only superseded stamp leaves the spec open",
  );
  assert.equal(result.complete, false);
});

test("a TEP with no implementing specs is not complete even under the superseded rule", () => {
  const result = tepComplete("TEP-6", []);
  assert.deepEqual(result.openSpecs, []);
  assert.equal(
    result.complete,
    false,
    "no specs ⇒ nothing delivered ⇒ not complete (superseded logic must not flip this)",
  );
});

test("the echoed `tep` id is preserved through the superseded-aware computation", () => {
  const result = tepComplete("TEP-6", [superseded("SP-a")]);
  assert.equal(result.tep, "TEP-6");
});
