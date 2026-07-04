/**
 * SP-6/14 AC4 — the pure `specDisplayState` classifier: a Spec's three
 * orthogonal facts (`superseded`, `archived`, `accepted`) collapse to ONE
 * lifecycle state with precedence **superseded > archived > accepted > open**,
 * returning the STRING LITERAL (never a `vscode.ThemeIcon`) so the icon /
 * contextValue / description all derive from a single source of truth.
 *
 * Superseded is a distinct state, separate from open / done / archived, and it
 * OUTRANKS archived (a Spec may be both).
 */
import "../../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";

import { specDisplayState } from "./SpecsProvider";

// ── the four distinct outputs ────────────────────────────────────────────────

test("specDisplayState → 'open' when none of the facts are set", () => {
  assert.equal(
    specDisplayState({ superseded: false, accepted: false, archived: false }),
    "open",
  );
});

test("specDisplayState → 'accepted' for an accepted (not archived / superseded) Spec", () => {
  assert.equal(
    specDisplayState({ superseded: false, accepted: true, archived: false }),
    "accepted",
  );
});

test("specDisplayState → 'archived' for an archived (not superseded) Spec", () => {
  assert.equal(
    specDisplayState({ superseded: false, accepted: false, archived: true }),
    "archived",
  );
});

test("specDisplayState → 'superseded' for a superseded Spec", () => {
  assert.equal(
    specDisplayState({ superseded: true, accepted: false, archived: false }),
    "superseded",
  );
});

// ── precedence ───────────────────────────────────────────────────────────────

test("AC4: superseded OUTRANKS archived (a Spec may be both) → 'superseded'", () => {
  assert.equal(
    specDisplayState({ superseded: true, accepted: false, archived: true }),
    "superseded",
  );
});

test("AC4: superseded OUTRANKS accepted → 'superseded'", () => {
  assert.equal(
    specDisplayState({ superseded: true, accepted: true, archived: false }),
    "superseded",
  );
});

test("AC4: archived outranks accepted (unchanged) → 'archived'", () => {
  assert.equal(
    specDisplayState({ superseded: false, accepted: true, archived: true }),
    "archived",
  );
});

test("specDisplayState returns a string literal, never a ThemeIcon", () => {
  const state = specDisplayState({
    superseded: true,
    accepted: false,
    archived: false,
  });
  assert.equal(typeof state, "string");
});
