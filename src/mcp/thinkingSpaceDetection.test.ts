/**
 * Unit tests for thinking space-shaped detection (TEP-tghb9t / TEP-0008). fs only,
 * no vscode, no server boot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { isThinkingSpaceDir } from "./thinkingSpaceDetection";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tk-thinking space-"));
}

test("a thinking space dir with a specs/ subdir is a thinking space", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "specs"));
  assert.equal(isThinkingSpaceDir(dir), true);
});

test("a `.thinkube/` holding only an api-token is NOT a thinking space", () => {
  // Reproduces the /home/thinkube/.thinkube token store that was wrongly
  // adopted as the default thinking space.
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "api-token"), "tk_secret");
  assert.equal(isThinkingSpaceDir(dir), false);
});

test("an empty dir is not a thinking space", () => {
  assert.equal(isThinkingSpaceDir(tmp()), false);
});

test("a non-existent dir is not a thinking space (no throw)", () => {
  assert.equal(isThinkingSpaceDir(path.join(tmp(), "does-not-exist")), false);
});

test("a file named specs (not a dir) does not count", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "specs"), "");
  assert.equal(isThinkingSpaceDir(dir), false);
});
