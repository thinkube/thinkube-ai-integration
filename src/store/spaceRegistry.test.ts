/**
 * spaceRegistry — cards on disk: discovery listing, declared-orgs
 * enforcement, and the expected-vs-found repository verification.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  readSpaceCard,
  listDeclaredSpaces,
  assertDeclaredOrgs,
  verifyRepoRemote,
} from "./spaceRegistry";

function tmpRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-space-reg-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return root;
}

const CARD = `repo:\n  remote: github.com/thinkube/thinkube-control\norgs: [cmxela]\n`;

test("listDeclaredSpaces returns root-relative names of card-bearing dirs, sorted", () => {
  const root = tmpRoot({
    "Platform/core/thinkube-control/space.yaml": CARD,
    "Platform/projects/rebrand/space.yaml": "orgs: [cmxela]\n",
    "Platform/projects/rebrand/cmxela/teps/.gitkeep": "",
    "Platform/stray-dir/README.md": "not a space",
  });
  assert.deepEqual(listDeclaredSpaces(root), [
    "Platform/core/thinkube-control",
    "Platform/projects/rebrand",
  ]);
});

test("readSpaceCard: present parses; absent is undefined", () => {
  const root = tmpRoot({ "s/space.yaml": CARD });
  assert.ok(readSpaceCard(path.join(root, "s"))!.repo);
  assert.equal(readSpaceCard(path.join(root, "nope")), undefined);
});

test("an undeclared maintainer subtree refuses loudly", () => {
  const root = tmpRoot({
    "s/space.yaml": "orgs: [cmxela]\n",
    "s/cmxela/teps/.gitkeep": "",
    "s/intruder/teps/.gitkeep": "",
  });
  const dir = path.join(root, "s");
  assert.throws(
    () => assertDeclaredOrgs(readSpaceCard(dir)!, dir),
    /"intruder\/".*not.*declared/s,
  );
});

test("verifyRepoRemote: match passes; mismatch states expected vs found", async () => {
  const card = readSpaceCard(
    path.join(tmpRoot({ "s/space.yaml": CARD }), "s"),
  )!;
  await verifyRepoRemote("/repo", card, "Platform/core/thinkube-control", async () => "github.com/thinkube/thinkube-control");
  await assert.rejects(
    verifyRepoRemote("/repo", card, "Platform/core/thinkube-control", async () => "github.com/other/fork"),
    (e: Error) =>
      /expected remote: github\.com\/thinkube\/thinkube-control/.test(e.message) &&
      /found:\s+github\.com\/other\/fork/.test(e.message),
  );
  await assert.rejects(
    verifyRepoRemote("/repo", card, "x", async () => undefined),
    /no origin remote/,
  );
});

test("a project card (no repo:) refuses to act as a working repo", async () => {
  const root = tmpRoot({ "p/space.yaml": "orgs: []\n" });
  await assert.rejects(
    verifyRepoRemote("/repo", readSpaceCard(path.join(root, "p"))!, "Platform/projects/rebrand", async () => "x/y/z"),
    /declares no repository/,
  );
});
