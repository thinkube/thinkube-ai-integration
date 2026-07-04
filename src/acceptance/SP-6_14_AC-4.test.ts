/**
 * SP-6/14 (TEP-6) AC4 — the board classifies a superseded spec as its OWN
 * display state: not open, not done (accepted), not merely archived.
 *
 * Exercises ONLY the pure classifier named in the spec contract:
 *
 *   export function specDisplayState(
 *     node: { superseded: boolean; accepted: boolean; archived: boolean },
 *   ): "superseded" | "accepted" | "open" | "archived";
 *
 * It returns a STRING LITERAL (never a `vscode.ThemeIcon`) — `specStatusIcon` /
 * `contextValue` / `description` all DERIVE from it. Precedence is pinned:
 *
 *   superseded > archived > accepted > open
 *
 * The AC in words:
 *   • a superseded spec classifies as "superseded" — a value DISTINCT from each
 *     of "open", "accepted", and "archived"; and
 *   • a spec that is BOTH superseded AND archived still classifies as
 *     "superseded" (superseded outranks archived — the whole point: a retired
 *     spec must not read as merely hidden).
 *
 * `specDisplayState` is pure (no fs, no vscode surface exercised), but it lives
 * in `SpecsProvider.ts`, whose module imports `vscode`. So — exactly as the MCP
 * unit tests do — we install the `require('vscode')` stub as the very FIRST
 * statement, BEFORE importing the module under test, so its top-level
 * `import * as vscode` resolves under the node:test runner.
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";

import { specDisplayState } from "../views/thinkingSpaces/SpecsProvider";

/** All three node facts default to false; override only what a case needs. */
function node(
  facts: Partial<{ superseded: boolean; accepted: boolean; archived: boolean }>,
): { superseded: boolean; accepted: boolean; archived: boolean } {
  return { superseded: false, accepted: false, archived: false, ...facts };
}

// ── The four base states are each their own distinct label ───────────────────

test('AC4: a plain open spec (no facts set) classifies as "open"', () => {
  assert.equal(specDisplayState(node({})), "open");
});

test('AC4: an accepted-only spec classifies as "accepted"', () => {
  assert.equal(specDisplayState(node({ accepted: true })), "accepted");
});

test('AC4: an archived-only spec classifies as "archived"', () => {
  assert.equal(specDisplayState(node({ archived: true })), "archived");
});

test('AC4: a superseded-only spec classifies as "superseded"', () => {
  assert.equal(specDisplayState(node({ superseded: true })), "superseded");
});

// ── The core of the AC: "superseded" is DISTINCT from the other three ────────

test("AC4: a superseded spec's state is separate from open, accepted, AND archived", () => {
  const superseded = specDisplayState(node({ superseded: true }));

  assert.equal(
    superseded,
    "superseded",
    "the superseded fact must produce the superseded state",
  );

  // Distinctness — it is none of the other three states, and each of the other
  // three states is itself a different value from the superseded one.
  assert.notEqual(
    superseded,
    "open",
    "superseded must not read as open (an un-started backlog spec)",
  );
  assert.notEqual(
    superseded,
    "accepted",
    "superseded must not read as accepted (a finished spec)",
  );
  assert.notEqual(
    superseded,
    "archived",
    "superseded must not read as merely archived (view-only hide)",
  );

  // The full label set is four genuinely distinct values.
  const labels = new Set([
    specDisplayState(node({})),
    specDisplayState(node({ accepted: true })),
    specDisplayState(node({ archived: true })),
    specDisplayState(node({ superseded: true })),
  ]);
  assert.equal(
    labels.size,
    4,
    "open / accepted / archived / superseded are four distinct states",
  );
});

// ── The pinned tie-break: superseded > archived (a spec may be both) ──────────

test('AC4: a spec that is BOTH superseded AND archived classifies as "superseded"', () => {
  // Superseded and archived are orthogonal facts — a spec may carry both. When
  // it does, superseded WINS: it must read as retired, not merely hidden.
  assert.equal(
    specDisplayState(node({ superseded: true, archived: true })),
    "superseded",
    'superseded outranks archived — a superseded+archived spec is still "superseded"',
  );
});

// ── The full precedence chain: superseded > archived > accepted > open ────────

test("AC4: superseded outranks every other fact combination", () => {
  // Whatever else is true, a superseded spec is "superseded".
  const combos: Array<Partial<{ accepted: boolean; archived: boolean }>> = [
    {},
    { accepted: true },
    { archived: true },
    { accepted: true, archived: true },
  ];
  for (const extra of combos) {
    assert.equal(
      specDisplayState(node({ superseded: true, ...extra })),
      "superseded",
      `superseded wins over ${JSON.stringify(extra)}`,
    );
  }
});

test('AC4: archived outranks accepted (below superseded) — an accepted+archived spec is "archived"', () => {
  assert.equal(
    specDisplayState(node({ archived: true, accepted: true })),
    "archived",
    "with no supersede, archived beats accepted",
  );
});

test('AC4: with only accepted set (no supersede, no archive) the state is "accepted", above open', () => {
  assert.equal(specDisplayState(node({ accepted: true })), "accepted");
});

test("AC4: the classifier returns a string literal, never a vscode.ThemeIcon", () => {
  // Guards the contract's "pure classifier returns a STRING state, not an icon"
  // requirement — icon/contextValue/description derive FROM this string.
  for (const facts of [
    node({}),
    node({ accepted: true }),
    node({ archived: true }),
    node({ superseded: true }),
    node({ superseded: true, archived: true, accepted: true }),
  ]) {
    const state = specDisplayState(facts);
    assert.equal(typeof state, "string", "the display state is a plain string");
    assert.ok(
      ["superseded", "accepted", "open", "archived"].includes(state),
      `state ${JSON.stringify(state)} is one of the four contract labels`,
    );
  }
});
