/**
 * SP-6/18 (TEP-6) AC1 — the author-time test-impact detector.
 *
 * `findUncoveredTests({ changedFiles, footprintPaths, repoFiles })` is the pure,
 * total, deterministic core of the prevention half of this Spec: given the
 * change's source blast radius (`changedFiles`), the slice's footprint, and an
 * injected `{ path, content }` view of the repo (NO disk / vscode / model), it
 * returns every TEST FILE that (a) is NOT already in the footprint and (b) imports
 * one of the changed files via a resolved RELATIVE module specifier — tagging each
 * violation `"unit"` (a plain `*.test.*`, folded into the footprint) or
 * `"held-out"` (a probe under `src/acceptance/`, retired-or-reconsidered, never
 * pulled into a code-author's footprint).
 *
 * This probe exercises ONLY that public core (the sibling module the SPEC CONTRACT
 * names — the same boundary SP-6/15 AC3 unit-covers `findUncoveredImporters` on),
 * over synthetic file maps, and makes no assumption about the internal scan
 * implementation. It pins the load-bearing facts of AC1:
 *
 *   1. EVERY uncovered test importer is flagged, tagged unit/held-out by whether
 *      it lives under `src/acceptance/`, ordered by test then changed;
 *   2. `[]` when every such test is already in the footprint (covered);
 *   3. `[]` when no test imports a changed file, and `[]` for empty `changedFiles`;
 *   4. specifier resolution is LEXICAL (`../` nesting, extensionless ⇒ `.ts`, an
 *      already-extensioned specifier kept, NO index resolution);
 *   5. precision — a NON-test importer and a bare/package specifier are out of
 *      scope, so a shared subject does not produce a spurious violation.
 *
 * Every fixture is `{ path, content }` only; assertions are on the returned
 * violation set (order + kind pinned), the contract's stated shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findUncoveredTests,
  type RepoFile,
  type TestImpactViolation,
} from "../services/testImpactFootprint";

// The two source files a slice changed — the blast radius the detector matches
// resolved relative imports against.
const CHANGED_REGRESSION = "src/services/regressionGate.ts";
const CHANGED_FOOTPRINT = "src/services/testImpactFootprint.ts";

// ── 1. EVERY uncovered test importer is flagged, tagged unit vs held-out ──────

test("SP-6/18 AC1 — findUncoveredTests flags every uncovered test importer, tagged held-out (src/acceptance/) vs unit, ordered by test then changed", () => {
  const repoFiles: RepoFile[] = [
    // A held-out acceptance probe that pulls in BOTH changed files — one via an
    // `import … from`, one via an `export … from` re-export (the contract collects
    // both). Its dir is `src/acceptance/`, so `../services/x` resolves up one level
    // to `src/services/x.ts` — both land on a changed file → two held-out violations.
    {
      path: "src/acceptance/SP-6_18_AC-9.test.ts",
      content:
        `import { regressionGateVerdict } from "../services/regressionGate";\n` +
        `export { findUncoveredTests } from "../services/testImpactFootprint";\n` +
        `// body\n`,
    },
    // A plain unit test that imports one changed file via a `./` specifier → one
    // "unit" violation (folded into the footprint, not retired).
    {
      path: "src/services/regressionGate.test.ts",
      content: `import { resolveRegressionCommand } from "./regressionGate";\n`,
    },
    // A test that imports only an UNRELATED (non-changed) module — proves the
    // detector is selective, not "any test with any import".
    {
      path: "src/services/other.test.ts",
      content: `import { x } from "./other";\n`,
    },
    // A NON-test source file that imports a changed file — must NOT be flagged;
    // only test files are in scope (its presence proves the empty slots aren't
    // vacuous — the same subject IS matched when it is a test, above).
    {
      path: "src/services/consumer.ts",
      content: `import { regressionGateVerdict } from "./regressionGate";\n`,
    },
  ];

  const violations = findUncoveredTests({
    changedFiles: [CHANGED_REGRESSION, CHANGED_FOOTPRINT],
    footprintPaths: [], // nothing covered — every importing test is uncovered
    repoFiles,
  });

  const expected: TestImpactViolation[] = [
    // Ordered by test (acceptance path sorts before services path), then by
    // changed (regressionGate.ts before testImpactFootprint.ts).
    {
      test: "src/acceptance/SP-6_18_AC-9.test.ts",
      changed: CHANGED_REGRESSION,
      kind: "held-out",
    },
    {
      test: "src/acceptance/SP-6_18_AC-9.test.ts",
      changed: CHANGED_FOOTPRINT,
      kind: "held-out",
    },
    {
      test: "src/services/regressionGate.test.ts",
      changed: CHANGED_REGRESSION,
      kind: "unit",
    },
  ];

  assert.deepEqual(
    violations,
    expected,
    "every uncovered test that imports a changed file is a violation — the " +
      "acceptance probe tagged held-out (both its import + re-export), the plain " +
      "test tagged unit; the non-importing test and the non-test consumer are not",
  );
});

// ── 2. [] when the importing tests are already in the footprint (covered) ─────

test("SP-6/18 AC1 — returns [] when every importing test is already in footprintPaths (covered)", () => {
  const repoFiles: RepoFile[] = [
    {
      path: "src/acceptance/SP-6_18_AC-9.test.ts",
      content: `import { regressionGateVerdict } from "../services/regressionGate";\n`,
    },
    {
      path: "src/services/regressionGate.test.ts",
      content: `import { resolveRegressionCommand } from "./regressionGate";\n`,
    },
  ];

  const violations = findUncoveredTests({
    changedFiles: [CHANGED_REGRESSION],
    // Both importers are IN the footprint — a covered test is exempt (the author
    // already owns it), so there is nothing uncovered to refuse.
    footprintPaths: [
      "src/acceptance/SP-6_18_AC-9.test.ts",
      "src/services/regressionGate.test.ts",
    ],
    repoFiles,
  });

  assert.deepEqual(
    violations,
    [],
    "the SAME importers that violate when uncovered produce no violation once " +
      "they are in the footprint — proving the empty verdict is coverage, not a " +
      "failure to detect",
  );
});

// ── 3. [] when no test imports a changed file, and for empty changedFiles ─────

test("SP-6/18 AC1 — returns [] when no test imports a changed file", () => {
  const violations = findUncoveredTests({
    changedFiles: [CHANGED_REGRESSION],
    footprintPaths: [],
    repoFiles: [
      // A test that imports a DIFFERENT relative module (not in changedFiles).
      {
        path: "src/services/regressionGate.test.ts",
        content: `import { helper } from "./unrelatedHelper";\n`,
      },
      // The changed file itself — nobody imports it here.
      {
        path: CHANGED_REGRESSION,
        content: `export const regressionGateVerdict = 1;\n`,
      },
    ],
  });

  assert.deepEqual(
    violations,
    [],
    "a changed file that no test imports is not a blast-radius gap — []",
  );
});

test("SP-6/18 AC1 — empty changedFiles short-circuits to [] even when a real test importer is present", () => {
  const violations = findUncoveredTests({
    changedFiles: [],
    footprintPaths: [],
    repoFiles: [
      {
        // This test DOES import a source module — but with no changed files there
        // is nothing to match against, so the result must be empty.
        path: "src/services/regressionGate.test.ts",
        content: `import { resolveRegressionCommand } from "./regressionGate";\n`,
      },
    ],
  });

  assert.deepEqual(
    violations,
    [],
    "empty changedFiles is a total short-circuit — []",
  );
});

// ── 4. LEXICAL specifier resolution: ../ nesting, extension handling, no index ─

test("SP-6/18 AC1 — resolves specifiers lexically: `../` nesting, extensionless ⇒ `.ts`, an already-extensioned specifier kept, and NO index resolution", () => {
  const CHANGED_FOO = "src/services/foo.ts"; // extensionless import target
  const CHANGED_COMPILED = "src/services/compiled.js"; // already-extensioned target
  const CHANGED_INDEX = "src/services/index.ts"; // the no-index-resolution decoy

  const violations = findUncoveredTests({
    changedFiles: [CHANGED_FOO, CHANGED_COMPILED, CHANGED_INDEX],
    footprintPaths: [],
    repoFiles: [
      {
        // Nested two levels under acceptance (dir `src/acceptance/deep`), so each
        // `../../services/x` climbs to `src/services/x`.
        path: "src/acceptance/deep/probe.test.ts",
        content:
          // extensionless → append `.ts` → src/services/foo.ts  (MATCH)
          `import a from "../../services/foo";\n` +
          // already ends `.js` → keep as-is → src/services/compiled.js  (MATCH)
          `import b from "../../services/compiled.js";\n` +
          // bare directory → append `.ts` → src/services.ts (NOT src/services/index.ts):
          // no index resolution, so this does NOT match the CHANGED_INDEX decoy.
          `import c from "../../services";\n`,
      },
    ],
  });

  const expected: TestImpactViolation[] = [
    // Ordered by changed: compiled.js < foo.ts. The index.ts decoy is absent —
    // proving `../../services` is not resolved to `.../index.ts`.
    {
      test: "src/acceptance/deep/probe.test.ts",
      changed: CHANGED_COMPILED,
      kind: "held-out",
    },
    {
      test: "src/acceptance/deep/probe.test.ts",
      changed: CHANGED_FOO,
      kind: "held-out",
    },
  ];

  assert.deepEqual(
    violations,
    expected,
    "extensionless imports gain `.ts`, an explicit extension is kept, `../` " +
      "segments climb the test's directory, and a directory specifier is NOT " +
      "matched to its index file",
  );
});

// ── 5. Precision: non-test importers and bare/package specifiers are out of scope

test("SP-6/18 AC1 — a non-test file that imports a changed file, and a test with only bare/package specifiers, are both out of scope (→ [])", () => {
  const violations = findUncoveredTests({
    changedFiles: [CHANGED_REGRESSION],
    footprintPaths: [],
    repoFiles: [
      // A non-test source file importing the changed file — not a test, so not a
      // test-blast-radius violation (the closing-gate compile owns this case).
      {
        path: "src/services/consumer.ts",
        content: `import { regressionGateVerdict } from "./regressionGate";\n`,
      },
      // A genuine test, but it imports only BARE/package specifiers — bare imports
      // are out of scope (only resolved RELATIVE specifiers can match a changed file).
      {
        path: "src/acceptance/bare.test.ts",
        content:
          `import { test } from "node:test";\n` +
          `import assert from "node:assert/strict";\n` +
          `import { thing } from "regressionGate";\n`,
      },
    ],
  });

  assert.deepEqual(
    violations,
    [],
    "only test files with RELATIVE imports of a changed file violate — a non-test " +
      "importer and bare/package specifiers never do",
  );
});
