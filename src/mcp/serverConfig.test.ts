/**
 * Unit tests for resolveServerConfig (SP-tgw52t_SL-1). Pure — no fs/vscode.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveServerConfig } from "./serverConfig";

test("env wins over the machine-level file", () => {
  const cfg = resolveServerConfig(
    { THINKUBE_THINKING_SPACE_ROOT: "/env/thinking space", THINKUBE_ROOTS: "/a:/b" },
    { thinkingSpaceRoot: "/file/thinking space", roots: ["/c"] },
    ":",
  );
  assert.equal(cfg.thinkingSpaceRoot, "/env/thinking space");
  assert.deepEqual(cfg.roots, ["/a", "/b"]);
});

test("falls back to the file when env is absent", () => {
  const cfg = resolveServerConfig(
    {},
    {
      thinkingSpaceRoot: "/file/thinking space",
      roots: ["/c", "/d"],
      folders: [{ name: "Platform", path: "/home/u/thinkube-platform" }],
    },
    ":",
  );
  assert.equal(cfg.thinkingSpaceRoot, "/file/thinking space");
  assert.deepEqual(cfg.roots, ["/c", "/d"]);
  assert.deepEqual(cfg.folders, [{ name: "Platform", path: "/home/u/thinkube-platform" }]);
});

test("no env, no file → safe defaults (writes on, docs gate BLOCKING, empty)", () => {
  const cfg = resolveServerConfig({}, null, ":");
  assert.equal(cfg.thinkingSpaceRoot, undefined);
  assert.deepEqual(cfg.roots, []);
  assert.deepEqual(cfg.folders, []);
  assert.equal(cfg.allowAIWrites, true);
  // Fail closed (2026-07-14): under advisory-by-default every TEP-21/SP-1
  // docs-required slice reached Done undocumented. Blocking is the default;
  // advisory must be an explicit choice.
  assert.equal(cfg.docsGateMode, "blocking");
});

test("THINKUBE_FOLDERS env parses and overrides the file", () => {
  const cfg = resolveServerConfig(
    { THINKUBE_FOLDERS: '[{"name":"X","path":"/x"}]' },
    { folders: [{ name: "Y", path: "/y" }] },
    ":",
  );
  assert.deepEqual(cfg.folders, [{ name: "X", path: "/x" }]);
});

test("allowAIWrites: env 'false' wins; else file; else true", () => {
  assert.equal(resolveServerConfig({ THINKUBE_ALLOW_AI_WRITES: "false" }, { allowAIWrites: true }).allowAIWrites, false);
  assert.equal(resolveServerConfig({}, { allowAIWrites: false }).allowAIWrites, false);
  assert.equal(resolveServerConfig({}, {}).allowAIWrites, true);
});

test("docsGateMode: advisory only when env EXPLICITLY says so (blocking otherwise — fail closed)", () => {
  assert.equal(resolveServerConfig({ THINKUBE_DOCS_GATE_MODE: "advisory" }, null).docsGateMode, "advisory");
  assert.equal(resolveServerConfig({ THINKUBE_DOCS_GATE_MODE: "blocking" }, null).docsGateMode, "blocking");
  assert.equal(resolveServerConfig({}, null).docsGateMode, "blocking");
});

test("malformed file folders are ignored (not thrown)", () => {
  const cfg = resolveServerConfig({}, { folders: [{ name: "ok", path: "/ok" }, { name: 1 } as never] }, ":");
  assert.deepEqual(cfg.folders, [{ name: "ok", path: "/ok" }]);
});
