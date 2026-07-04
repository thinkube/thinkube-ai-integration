/**
 * SP-6/14 — the pure backlog-exclusion core: `isSuperseded` mirrors `isAccepted`,
 * and `tepComplete` treats a superseded Spec as resolved (removed from
 * `openSpecs`) exactly as it treats an accepted one.
 *
 * AC1 — a superseded Spec is excluded from `openSpecs`, and a TEP whose Specs are
 *       ALL accepted-or-superseded (including all-superseded / zero-accepted)
 *       reports `complete: true`.
 * AC3 — superseded ≠ accepted: `isSuperseded` is true only for a non-empty
 *       trimmed `superseded` stamp, blind to `accepted`.
 *
 * Pure, model-free, `env: local` — no fs, no vscode.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isSuperseded,
  tepComplete,
  type ImplementingSpec,
} from "./tepLifecycle";

// ── isSuperseded — exact mirror of isAccepted ────────────────────────────────

test("isSuperseded: true iff `superseded` is a non-empty trimmed string", () => {
  assert.equal(
    isSuperseded({ id: "SP-1", superseded: "2026-07-04T00:00:00Z" }),
    true,
  );
  assert.equal(isSuperseded({ id: "SP-1" }), false, "absent → false");
  assert.equal(
    isSuperseded({ id: "SP-1", superseded: "" }),
    false,
    "empty → false",
  );
  assert.equal(
    isSuperseded({ id: "SP-1", superseded: "   " }),
    false,
    "whitespace-only → false",
  );
});

test("AC3: isSuperseded is orthogonal to accepted — an accepted-not-superseded Spec is not superseded", () => {
  // accepted but NOT superseded ⇒ isSuperseded false (they are distinct facts).
  assert.equal(
    isSuperseded({ id: "SP-1", accepted: "2026-07-04T00:00:00Z" }),
    false,
  );
  // superseded but NOT accepted ⇒ isSuperseded true.
  assert.equal(
    isSuperseded({ id: "SP-1", superseded: "2026-07-04T00:00:00Z" }),
    true,
  );
});

// ── tepComplete — superseded excluded from openSpecs ─────────────────────────

test("AC1: a superseded Spec is excluded from openSpecs", () => {
  const specs: ImplementingSpec[] = [
    { id: "SP-1", accepted: "2026-07-04T00:00:00Z" },
    { id: "SP-2", superseded: "2026-07-04T00:00:00Z" },
    { id: "SP-3" }, // genuinely open
  ];
  const r = tepComplete("42", specs);
  assert.deepEqual(r.openSpecs, ["SP-3"]);
  assert.equal(r.complete, false);
  assert.equal(r.tep, "TEP-42");
});

test("AC1: a TEP whose Specs are all accepted-or-superseded is complete", () => {
  const specs: ImplementingSpec[] = [
    { id: "SP-1", accepted: "2026-07-04T00:00:00Z" },
    { id: "SP-2", superseded: "2026-07-04T00:00:00Z" },
  ];
  const r = tepComplete("42", specs);
  assert.deepEqual(r.openSpecs, []);
  assert.equal(r.complete, true);
});

test("AC1: an all-superseded (zero-accepted) TEP reports complete: true", () => {
  const specs: ImplementingSpec[] = [
    { id: "SP-1", superseded: "2026-07-04T00:00:00Z" },
    { id: "SP-2", superseded: "2026-07-05T00:00:00Z" },
  ];
  const r = tepComplete("42", specs);
  assert.deepEqual(r.openSpecs, []);
  assert.equal(r.complete, true);
});

test("a TEP with no implementing Specs is not complete (nothing delivered)", () => {
  const r = tepComplete("42", []);
  assert.equal(r.complete, false);
  assert.deepEqual(r.openSpecs, []);
});

test("a superseded stamp that is whitespace-only leaves the Spec open", () => {
  const specs: ImplementingSpec[] = [{ id: "SP-1", superseded: "  " }];
  const r = tepComplete("42", specs);
  assert.deepEqual(r.openSpecs, ["SP-1"]);
  assert.equal(r.complete, false);
});
