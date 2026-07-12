// AC-3 — the command-palette family is unified under the Tandem brand.
//
// WHY: The extension previously scattered its 52 commands across six pre-rebrand category
// labels: 'Thinkube AI' (17), bare 'Thinkube' (3), 'Thinkube Kanban' (2),
// 'Thinkube Specs' (9), 'Thinkube TEPs' (7), and 'Thinkube ThinkingSpaces' (13),
// plus one untouched third-party label 'Claude Code'. After the rebrand they must
// unify under 'Thinkube Tandem', 'Tandem Kanban', 'Tandem Specs', 'Tandem TEPs',
// and 'Tandem ThinkingSpaces'. README.md and CLAUDE.md must no longer use 'Thinkube AI'
// to name the activity-bar entry.
//
// Each test is labelled TRANSITION or INVARIANT:
//   TRANSITION — proves a one-time change happened; its job is complete once the change ships.
//   INVARIANT  — a behaviour that must always hold; this test lives forever.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// The compiled file lands at out-test/acceptance/; two levels up is the repo root.
const ROOT = path.resolve(__dirname, "../../");

function readRoot(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

interface PkgCommand {
  command: string;
  title: string;
  category?: string;
}

interface PkgViewsContainer {
  id: string;
  title: string;
  icon?: string;
}

interface PkgJson {
  contributes: {
    viewsContainers: {
      activitybar: PkgViewsContainer[];
    };
    commands: PkgCommand[];
  };
}

function loadPkg(): PkgJson {
  return JSON.parse(readRoot("package.json")) as PkgJson;
}

// ── activity-bar container title ──────────────────────────────────────────────
//
// WHY (INVARIANT — must always hold): the activity-bar container that anchors all
// Tandem sidebar views must be titled 'Thinkube Tandem'. Any deviation is an
// identity defect visible to every user who opens the activity bar.

test("activity-bar container title is 'Thinkube Tandem'", () => {
  const pkg = loadPkg();
  const ab = pkg.contributes.viewsContainers.activitybar;
  assert.ok(
    ab.length > 0,
    "at least one activity-bar container must be declared",
  );
  // The extension registers exactly one activity-bar container (id: 'thinkube').
  const tandem = ab.find((c) => c.id === "thinkube");
  assert.ok(
    tandem !== undefined,
    "activity-bar container with id 'thinkube' must exist",
  );
  assert.equal(
    tandem!.title,
    "Thinkube Tandem",
    "activity-bar container title must be 'Thinkube Tandem'",
  );
});

// ── old category labels are gone ──────────────────────────────────────────────
//
// WHY (TRANSITION — proves the rebrand happened): the six pre-rebrand category
// strings ('Thinkube AI', 'Thinkube', 'Thinkube Kanban', 'Thinkube Specs',
// 'Thinkube TEPs', 'Thinkube ThinkingSpaces') must no longer appear on any command.
// Once the change ships, their absence is permanent and this check's work is done.

const FORBIDDEN_CATEGORIES: readonly string[] = [
  "Thinkube AI",
  "Thinkube",
  "Thinkube Kanban",
  "Thinkube Specs",
  "Thinkube TEPs",
  "Thinkube ThinkingSpaces",
];

test("no command category uses a pre-rebrand label", () => {
  const pkg = loadPkg();
  const violations: string[] = [];
  for (const cmd of pkg.contributes.commands) {
    if (
      cmd.category !== undefined &&
      FORBIDDEN_CATEGORIES.includes(cmd.category)
    ) {
      violations.push(`${cmd.command}: category="${cmd.category}"`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `commands still carrying old pre-rebrand category labels:\n  ${violations.join("\n  ")}`,
  );
});

// ── total command count ───────────────────────────────────────────────────────
//
// WHY (TRANSITION — proves the rebrand was rename-only): the spec mandates exactly
// 52 commands across the 7 categories; pinning the count proves no command was
// accidentally added or removed during the rename. The count is expected to grow
// as the extension evolves, but at the moment of the rebrand it must be exactly 52.

test("total command count is 52", () => {
  const pkg = loadPkg();
  const count = pkg.contributes.commands.length;
  assert.equal(
    count,
    52,
    `expected exactly 52 commands, got ${count} — the rebrand must not add or remove commands`,
  );
});

// ── README.md activity-bar reference ─────────────────────────────────────────
//
// WHY (TRANSITION — proves the docs rebrand landed): README.md used to describe the
// activity-bar entry as 'Thinkube AI'; after the rebrand every such reference must
// read 'Thinkube Tandem'. Absence of 'Thinkube AI' in this file proves the update
// happened. Once the change ships, this assertion's job is complete.

test("README.md contains no 'Thinkube AI' description of the activity bar", () => {
  const readme = readRoot("README.md");
  // 'Thinkube AI' (as a standalone label, not 'thinkube-ai-integration' the repo slug)
  // only appears in README.md in the context of naming the activity-bar entry.
  // Any occurrence is a missed update.
  const idx = readme.indexOf("Thinkube AI");
  assert.equal(
    idx,
    -1,
    `README.md still contains 'Thinkube AI' at offset ${idx} — expected it to be replaced with 'Thinkube Tandem'`,
  );
});

// ── CLAUDE.md activity-bar reference ─────────────────────────────────────────
//
// WHY (TRANSITION — proves the docs rebrand landed): CLAUDE.md used to describe the
// activity-bar sidebar view as 'Thinkube AI'; after the rebrand every such reference
// must read 'Thinkube Tandem'. Once the change ships, this assertion's job is complete.

test("CLAUDE.md contains no 'Thinkube AI' description of the activity bar", () => {
  const claude = readRoot("CLAUDE.md");
  const idx = claude.indexOf("Thinkube AI");
  assert.equal(
    idx,
    -1,
    `CLAUDE.md still contains 'Thinkube AI' at offset ${idx} — expected it to be replaced with 'Thinkube Tandem'`,
  );
});
