// SP-1/1 AC4 — dist/extension.js exists and statically exports activate after the rebrand compile.
//
// WHY (INVARIANT — must always hold, lives forever): VS Code loads an extension ONLY when its
// compiled entry-point exports a function named `activate`. This probe verifies both that
// `npm run compile` produced dist/extension.js and that the compiled text matches
// /exports\.activate\s*=/, confirming the activation contract survives the identity rename.
// Static text check only — no require() or execution — because this repo has no Extension-Host
// harness safe to run the extension in (no @vscode/test-electron; npm test points at a
// nonexistent file; the one vscode stub lacks APIs activate() calls).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

test("dist/extension.js exists after compile", () => {
  // The test runner is invoked from the project root, so process.cwd() resolves
  // to the directory that owns dist/ (written by `npm run compile`).
  const distPath = resolve(process.cwd(), "dist", "extension.js");

  assert.ok(
    existsSync(distPath),
    `dist/extension.js not found at ${distPath} — run \`npm run compile\` first`,
  );
});

test("dist/extension.js text matches /exports\\.activate\\s*=/ (static VS Code activation-contract check — no execution)", () => {
  const distPath = resolve(process.cwd(), "dist", "extension.js");

  // Guard: skip the regex assertion if the file doesn't exist so the
  // failure message comes from the existence test above, not a read error.
  if (!existsSync(distPath)) {
    return;
  }

  const text = readFileSync(distPath, "utf8");

  assert.match(
    text,
    /exports\.activate\s*=/,
    "dist/extension.js must export an activate function " +
      "(pattern: /exports\\.activate\\s*=/) — VS Code will refuse to load an " +
      "extension whose compiled entry-point lacks this export",
  );
});
