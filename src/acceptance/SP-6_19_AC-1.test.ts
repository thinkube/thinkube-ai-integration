/**
 * SP-6/19 (TEP-6) AC1 — the mint's approval hash is a pure, body-only helper.
 *
 * `specApprovalHash(rawFileText)` hashes ONLY the document body: the leading `---` … `---`
 * frontmatter fence is parsed out (a fence-less raw is all-body). So two raw texts with an
 * identical body but different frontmatter produce the SAME hash (frontmatter is machinery and
 * must never invalidate an approval), and two with different bodies produce DIFFERENT hashes (any
 * body edit re-arms the gate).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { specApprovalHash } from "../services/specApprovalHash";

const BODY = [
  "# The reviewed spec",
  "",
  "Body content the maintainer actually approves.",
  "",
].join("\n");

const EDITED_BODY = BODY.replace("actually approves", "no longer approves");

/** A synthetic raw spec file: a leading `---`…`---` frontmatter fence, then the body. */
function rawDoc(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

test("AC1: same body under different frontmatter → same hash (frontmatter-invariant)", () => {
  const fmA = "implements: TEP-6\nrepo: owner/name";
  const fmB =
    "implements: TEP-6\nrepo: owner/name\nstatus: ready\nac_verifications_signature: deadbeef";
  assert.equal(
    specApprovalHash(rawDoc(fmA, BODY)),
    specApprovalHash(rawDoc(fmB, BODY)),
    "a frontmatter-only change must not move the approval hash",
  );
});

test("AC1: different body → different hash (body-sensitive)", () => {
  const fm = "implements: TEP-6";
  assert.notEqual(
    specApprovalHash(rawDoc(fm, BODY)),
    specApprovalHash(rawDoc(fm, EDITED_BODY)),
    "any body edit must move the approval hash",
  );
});

test("AC1: a fence-less raw is hashed as all-body", () => {
  // No leading `---` fence → the whole text is the body, so wrapping that exact body under any
  // frontmatter fence yields the same hash.
  assert.equal(
    specApprovalHash(BODY),
    specApprovalHash(rawDoc("implements: TEP-6", BODY)),
  );
});
