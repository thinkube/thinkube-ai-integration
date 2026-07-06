/**
 * SP-6/19 (TEP-6) AC3 — the mint path routes its approval hash through the single helper and
 * cannot re-inline a divergent one.
 *
 * `src/views/review/ReviewPanel.ts` (the mint) must contain the token `specApprovalHash(` and must
 * contain NO occurrence of `approvalContentHash(` — in code OR comment (the SP-6/17 "no lingering
 * comment" lesson). This is deliberately MINT-SIDE only: the Spec hardens the side that actually
 * broke and leaves the gate's already-correct `approvalContentHash(specDoc.body)` untouched (its
 * ~40-importer blast radius is not worth hardening a path that never failed).
 *
 * Both search tokens are assembled from concatenated parts so THIS probe's own source cannot
 * self-match. grep runs through `execFileSync` with an args array (no shell); exit 1 (no match) is
 * a legitimate result, any other non-zero exit (2+ / spawn error) is a broken search and is
 * rethrown — a blanket catch would mask a broken search as a false pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

// Assembled from parts so the probe's own source cannot match the searches.
const CONTENT_HASH = ["approval", "Content", "Hash"].join("") + "("; // approvalContentHash(
const SPEC_HASH = ["spec", "Approval", "Hash"].join("") + "("; // specApprovalHash(

const REVIEW_PANEL = path.join(
  process.cwd(),
  "src",
  "views",
  "review",
  "ReviewPanel.ts",
);

/**
 * Whether a single file contains TOKEN. `grep -F TOKEN file`: exit 0 = match (true), exit 1 = no
 * match (false), exit 2+ (e.g. missing file / spawn error) = rethrow so a broken check can't read
 * as a pass.
 */
function fileHasToken(file: string, token: string): boolean {
  try {
    execFileSync("grep", ["-F", token, file], { encoding: "utf8" });
    return true; // exit 0 = at least one match
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 1) return false; // exit 1 = no match
    throw err; // exit 2+ (or spawn error) = broken search → surface it
  }
}

test("ReviewPanel.ts routes its approval hash through specApprovalHash(", () => {
  assert.ok(
    fileHasToken(REVIEW_PANEL, SPEC_HASH),
    `src/views/review/ReviewPanel.ts must call ${SPEC_HASH}`,
  );
});

test("ReviewPanel.ts contains no approvalContentHash( (code or comment)", () => {
  assert.ok(
    !fileHasToken(REVIEW_PANEL, CONTENT_HASH),
    `src/views/review/ReviewPanel.ts must contain no ${CONTENT_HASH} occurrence, so the mint cannot re-inline a divergent hash`,
  );
});
