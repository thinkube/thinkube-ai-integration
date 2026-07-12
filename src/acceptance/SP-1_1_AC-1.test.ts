// SP-1/1 AC1 — package.json and package-lock.json carry the thinkube-tandem identity.
//
// This file probes the five identity fields that prove the TEP-1 rebrand landed in the
// manifest layer: `name`, `displayName`, `repository.url` in package.json (three fields
// changed), `publisher` in package.json (one field that must NOT change), and the two
// lockfile name fields that must stay in sync with the package rename.
//
// All reads are synchronous filesystem operations against the project root — there is no
// module to import, no build step to exercise. The tests compile and run before any other
// implementation work lands; they describe WHAT must be true, not HOW it is achieved.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// The compiled test lives at out-test/acceptance/SP-1_1_AC-1.test.js.
// Two levels up from that directory is the project root.
const ROOT = path.resolve(__dirname, "../..");

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, relPath), "utf8"),
  ) as Record<string, unknown>;
}

// ── package.json: name and displayName adopt the Tandem brand ─────────────────
// WHY (one-time TRANSITION — its job is done once the rename ships): proves that
// `name` changed from "thinkube-ai-integration" to "thinkube-tandem" and
// `displayName` from the old label to "Thinkube Tandem".  These are the root
// identity fields; every other rebrand assertion flows from them.  Once the
// rename is live this probe's change-proof role is complete.

test("package.json name is 'thinkube-tandem' (TRANSITION: renamed from thinkube-ai-integration)", () => {
  const pkg = readJson("package.json");
  assert.equal(
    pkg.name,
    "thinkube-tandem",
    "package.json name must be thinkube-tandem after the TEP-1 rebrand",
  );
});

test("package.json displayName is 'Thinkube Tandem' (TRANSITION: display label updated with the brand)", () => {
  const pkg = readJson("package.json");
  assert.equal(
    pkg.displayName,
    "Thinkube Tandem",
    "package.json displayName must be 'Thinkube Tandem' after the TEP-1 rebrand",
  );
});

// ── package.json: publisher must not change ────────────────────────────────────
// WHY (standing INVARIANT — lives forever): the extension id is `<publisher>.<name>`.
// A publisher change silently mints a new extension id and orphans every installed-
// base globalStorage entry (signing keys, approval tokens).  This guard fires if the
// publisher field is ever accidentally altered during a future rename.

test("package.json publisher is 'thinkube' (INVARIANT: must not change — drives the extension id)", () => {
  const pkg = readJson("package.json");
  assert.equal(
    pkg.publisher,
    "thinkube",
    "publisher must remain 'thinkube'; changing it creates a new extension id and orphans globalStorage",
  );
});

// ── package.json: repository.url points at the renamed GitHub location ─────────
// WHY (one-time TRANSITION — its job is done once the GitHub repo is renamed):
// proves `repository.url` was updated to reflect the thinkube-ai-integration →
// thinkube-tandem rename in the thinkube org.  The probe checks the field as a
// plain string value (per the AC's explicit note): whether the remote URL actually
// resolves is an out-of-band ops concern, not this probe's responsibility.

test("package.json repository.url is set to the renamed GitHub repo (TRANSITION)", () => {
  const pkg = readJson("package.json");
  const repo = pkg.repository as { url?: string } | undefined;
  assert.ok(repo, "package.json must have a 'repository' field");
  assert.equal(
    repo!.url,
    "https://github.com/thinkube/thinkube-tandem",
    "repository.url must point at the renamed GitHub repo after the TEP-1 rebrand",
  );
});

// ── package-lock.json: both name fields reflect the rename ────────────────────
// WHY (one-time TRANSITION — its job is done once the lockfile is regenerated):
// npm writes `name` at the lockfile top level AND inside `packages[""]`.  Both
// must agree with the new package name or tooling can misidentify the package.
// These two assertions prove the lockfile was regenerated (not just the package
// manifest edited) so the rename is fully coherent across the npm artefacts.

test("package-lock.json top-level name is 'thinkube-tandem' (TRANSITION: lockfile regenerated after rename)", () => {
  const lock = readJson("package-lock.json");
  assert.equal(
    lock.name,
    "thinkube-tandem",
    "package-lock.json top-level name must be thinkube-tandem — regenerate the lockfile if not",
  );
});

test("package-lock.json packages[''].name is 'thinkube-tandem' (TRANSITION: lockfile packages entry updated)", () => {
  const lock = readJson("package-lock.json");
  const packages = lock.packages as
    Record<string, Record<string, unknown>> | undefined;
  assert.ok(
    packages && packages[""],
    "package-lock.json must have a packages[''] entry (the root package record)",
  );
  assert.equal(
    packages![""].name,
    "thinkube-tandem",
    "packages[''].name must be thinkube-tandem — both lockfile name fields must agree",
  );
});
