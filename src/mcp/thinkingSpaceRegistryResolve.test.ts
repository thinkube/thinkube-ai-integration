/**
 * ThinkingSpaceRegistry.resolve — a Project is a first-class but code-less thinking space,
 * addressable by its `<product>/projects/<id>` namespace (TEP-5 / the project
 * layer). installVscodeStub pattern (stub imported FIRST, since resolve builds a
 * ThinkubeStore).
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkingSpaceRegistry } from "./kanbanMcpServer";

test("resolve addresses a Project as a first-class thinking space (code-less, store path = thinking space dir)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-projthinkingSpace-"));
  // A code-less project thinking space: <product>/projects/<id> holding its org-tree teps.
  fs.mkdirSync(
    path.join(
      root,
      "Platform",
      "projects",
      "rebrand",
      "cmxela",
      "teps",
      "TEP-1",
    ),
    { recursive: true },
  );
  const reg = new ThinkingSpaceRegistry({
    thinkingSpaceRoot: root,
    folders: [],
    roots: [],
  } as never);
  const store = reg.resolve("Platform/projects/rebrand");
  // Its store IS rooted at the project dir (no separate code repo).
  assert.equal(
    store.thinkubeDir,
    path.join(root, "Platform", "projects", "rebrand"),
  );
});

test("resolve: a co-located thinking space by ABSOLUTE PATH lands where its namespace does (no container double-apply)", () => {
  // Regression: the thinking-space root coincides with a workspace folder
  // ("Tandem Board" → container `Tandem-Board`) at the SAME path. Addressing a
  // thinking space under it by absolute path used to run namespaceForRepo (which
  // prepends `Tandem-Board/…`) and re-root under the same dir, yielding a phantom
  // `<root>/Tandem-Board/Platform/projects/plugin-delivery` with the `cmxela/teps`
  // org tree lost. It must resolve to the co-located tree instead — the same dir
  // the `<product>/projects/<id>` namespace resolves to.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-colocated-"));
  const projAbs = path.join(root, "Platform", "projects", "plugin-delivery");
  fs.mkdirSync(path.join(projAbs, "cmxela", "teps", "TEP-6"), {
    recursive: true,
  });
  const reg = new ThinkingSpaceRegistry({
    thinkingSpaceRoot: root,
    folders: [{ name: "Tandem Board", path: root }],
    roots: [],
  } as never);

  // Absolute path resolves to the co-located tree (org `cmxela` preserved)…
  const byPath = reg.resolve(projAbs);
  assert.equal(byPath.thinkubeDir, projAbs);
  // …identical to the project-namespace resolution — one thinking space, one answer.
  const byNs = reg.resolve("Platform/projects/plugin-delivery");
  assert.equal(byNs.thinkubeDir, byPath.thinkubeDir);
});

test("resolve still rejects an unknown non-project id", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-projthinkingSpace2-"));
  const reg = new ThinkingSpaceRegistry({
    thinkingSpaceRoot: root,
    folders: [],
    roots: [],
  } as never);
  assert.throws(() => reg.resolve("Platform/nope/whatever"), /Unknown thinking space/);
});

test("resolve REFUSES an omitted thinking space — no default thinking space, thinking_space= is mandatory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-projthinkingSpace4-"));
  const reg = new ThinkingSpaceRegistry({
    thinkingSpaceRoot: root,
    folders: [],
    roots: [],
  } as never);
  // The session must never silently act on the cwd's repo thinking space — an omitted
  // thinking space is an error, not an inferred default.
  assert.throws(() => reg.resolve(undefined), /thinking space is required/i);
  assert.throws(() => reg.resolve(""), /thinking space is required/i);
  assert.throws(() => reg.resolve("   "), /thinking space is required/i);
});
