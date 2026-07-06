/**
 * SP-6/19 (TEP-6) AC2 — cross-check round-trip: a mint-side token verifies under the GATE's own
 * content-hash formula.
 *
 * A token is minted with `mintApproval(subjectKey, specApprovalHash(rawText), issuedAt, secret)`
 * (the mint side) and stored in a temp `createApprovalStore(dir)`. It is then verified with the
 * gate's OWN formula as the expected content hash — `approvalStatus(get(subjectKey), { subjectKey,
 * contentHash: approvalContentHash(parseFrontmatter(rawText2).body), secret })` — composed here
 * from `approvalContentHash` + `parseFrontmatter` INDEPENDENTLY of `specApprovalHash`. That
 * independence is the point: it pins that the mint helper and the gate's body-hash produce the
 * SAME content hash. A mint-side implementation that drifted from the gate's formula would fail
 * this probe.
 *
 *   • rawText2 differs from rawText only in FRONTMATTER  → ok === true  (frontmatter-invariant)
 *   • rawText2 differs from rawText in the BODY          → ok === false, reason "content-mismatch"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { specApprovalHash } from "../services/specApprovalHash";
import {
  approvalContentHash,
  approvalStatus,
  loadOrCreateApprovalSecret,
  mintApproval,
} from "../services/approvalToken";
import { createApprovalStore } from "../services/approvalStore";
import { parseFrontmatter } from "../store/frontmatter";

const SUBJECT = "spec:TEP-6/SP-19";
const BODY = ["# SP-19", "", "The approved body, byte-for-byte.", ""].join("\n");

function rawDoc(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

/** The gate's own expected content hash, composed independently of `specApprovalHash`. */
function gateContentHash(rawText: string): string {
  return approvalContentHash(parseFrontmatter(rawText).body);
}

function withTmpStore(
  fn: (dir: string) => void,
): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp19-ac2-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("AC2: mint-side token verifies under the gate's formula across a frontmatter-only edit", () => {
  withTmpStore((dir) => {
    const secret = loadOrCreateApprovalSecret(dir);
    const raw = rawDoc("implements: TEP-6\nrepo: owner/name", BODY);

    // Mint on the mint side, over specApprovalHash(raw), and store it.
    const token = mintApproval(SUBJECT, specApprovalHash(raw), 1234, secret);
    const store = createApprovalStore(dir);
    store.put(SUBJECT, token);

    // A frontmatter-only edit: same body, different frontmatter.
    const raw2 = rawDoc(
      "implements: TEP-6\nrepo: owner/name\nstatus: ready\nac_verifications_signature: cafe",
      BODY,
    );
    const status = approvalStatus(store.get(SUBJECT), {
      subjectKey: SUBJECT,
      contentHash: gateContentHash(raw2),
      secret,
    });
    assert.equal(
      status.ok,
      true,
      "a frontmatter-only edit must leave the stored approval valid under the gate's formula",
    );
  });
});

test("AC2: the same token becomes content-mismatch once the body is edited", () => {
  withTmpStore((dir) => {
    const secret = loadOrCreateApprovalSecret(dir);
    const raw = rawDoc("implements: TEP-6", BODY);

    const token = mintApproval(SUBJECT, specApprovalHash(raw), 1234, secret);
    const store = createApprovalStore(dir);
    store.put(SUBJECT, token);

    // A body edit: same frontmatter, different body.
    const raw2 = rawDoc(
      "implements: TEP-6",
      BODY.replace("byte-for-byte", "tampered"),
    );
    const status = approvalStatus(store.get(SUBJECT), {
      subjectKey: SUBJECT,
      contentHash: gateContentHash(raw2),
      secret,
    });
    assert.equal(status.ok, false, "a body edit must invalidate the approval");
    assert.equal(
      status.ok === false && status.reason,
      "content-mismatch",
      "the refusal reason must be content-mismatch",
    );
  });
});
