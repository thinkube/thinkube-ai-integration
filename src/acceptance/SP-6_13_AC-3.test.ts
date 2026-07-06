/**
 * SP-6/13 (TEP-6) AC3 — the fast path adds no waiting, and the pre-existing outcomes survive.
 *
 * SP-13 makes `mergeSpecPr` robust to the create→merge race by polling a new `PrOps.mergeable`
 * probe before `ops.merge`, sleeping (via an injected `sleep`) between not-mergeable attempts.
 * This AC pins the *no-regression* half of that change:
 *
 *   • An already-mergeable PR (openPrCount 1, `mergeable` true on the FIRST poll) merges on the
 *     first attempt with ZERO injected-delay calls — the fast path never waits.
 *   • The existing NO-PR outcome survives: no open PR + nothing ahead of main → `{ merged:false,
 *     reason:"no-pr" }`, and neither the poll nor the merge runs.
 *   • The existing ALREADY-MERGED race survives and takes precedence: when `ops.merge` THROWS an
 *     already-merged / "no commits between" error, the result is still an `alreadyMerged` success,
 *     never a bounded failure.
 *
 * Exercises ONLY the public interface in the SPEC CONTRACT (`mergeSpecPr`, `PrOps`,
 * `SpecMergeResult`) — it makes no assumption about the internal poll implementation beyond the
 * pinned observables (sleep-call count, the `mergeable` boolean, the result shape).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeSpecPr, type PrOps } from "../github/specMerge";

/**
 * A PrOps with safe defaults — no open PR, nothing ahead of main, no-op open/merge, and (per the
 * SP-13 contract, which makes `mergeable` REQUIRED) a `mergeable` default of `true` so a count=1
 * test reaches the merge on the first poll. Override per test.
 */
function ops(over: Partial<PrOps> = {}): PrOps {
  return {
    openPrCount: async () => 0,
    unmergedCommits: async () => 0,
    openPr: async () => {},
    merge: async () => "",
    mergeable: async () => true,
    ...over,
  };
}

/** A no-op sleep that counts its calls — the injected delay seam (no real waiting). */
function countingSleep() {
  let calls = 0;
  const sleep = async (_ms: number) => {
    calls += 1;
  };
  return {
    sleep,
    get calls() {
      return calls;
    },
  };
}

// ── AC3 core: an already-mergeable PR merges on the first attempt with ZERO waits ──────────────

test("AC3: an already-mergeable open PR (mergeable true on the first poll) merges with ZERO injected sleep calls", async () => {
  const timer = countingSleep();
  let mergeCalls = 0;
  let mergeableCalls = 0;

  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({
      openPrCount: async () => 1, // an open PR exists → reach the poll
      mergeable: async () => {
        mergeableCalls += 1;
        return true; // mergeable on the very first poll — the fast path
      },
      merge: async () => {
        mergeCalls += 1;
        return "Merged PR #7";
      },
    }),
    { sleep: timer.sleep },
  );

  assert.deepEqual(
    res,
    {
      branch: "spec/SP-tg8dsb",
      merged: true,
      opened: false,
      output: "Merged PR #7",
    },
    "an already-mergeable open PR merges and returns the open-PR success shape",
  );
  assert.equal(
    timer.calls,
    0,
    "the fast path adds NO waiting — mergeable-first-poll ⇒ exactly 0 sleep calls",
  );
  assert.equal(mergeCalls, 1, "merge runs exactly once on the fast path");
  assert.ok(
    mergeableCalls >= 1,
    "the mergeability probe is consulted before the merge",
  );
});

test("AC3: the mergeable-first fast path does not depend on maxAttempts — still zero waits with an explicit small bound", async () => {
  // Even with a tiny explicit bound, a PR mergeable on the first poll never sleeps: the loop
  // returns on the first `true` without touching the delay seam.
  const timer = countingSleep();

  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({
      openPrCount: async () => 1,
      mergeable: async () => true,
      merge: async () => "Merged PR #12",
    }),
    { sleep: timer.sleep, maxAttempts: 2 },
  );

  assert.deepEqual(res, {
    branch: "spec/SP-tg8dsb",
    merged: true,
    opened: false,
    output: "Merged PR #12",
  });
  assert.equal(
    timer.calls,
    0,
    "mergeable on the first poll ⇒ 0 sleep calls regardless of maxAttempts",
  );
});

// ── AC3: the existing NO-PR outcome is preserved (no poll, no merge, no waiting) ────────────────

test("AC3: no open PR and nothing ahead of main → no-pr, and neither the poll nor the merge run", async () => {
  const timer = countingSleep();
  let mergeableCalled = false;
  let openCalled = false;
  let mergeCalled = false;

  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({
      openPrCount: async () => 0, // no open PR
      unmergedCommits: async () => 0, // nothing ahead of main → genuine straight-to-main
      mergeable: async () => {
        mergeableCalled = true;
        return true;
      },
      openPr: async () => {
        openCalled = true;
      },
      merge: async () => {
        mergeCalled = true;
        return "should not happen";
      },
    }),
    { sleep: timer.sleep },
  );

  assert.deepEqual(
    res,
    { branch: "spec/SP-tg8dsb", merged: false, reason: "no-pr" },
    "a genuine straight-to-main Spec is still a benign no-pr no-op",
  );
  assert.equal(openCalled, false, "no PR is opened on the no-pr path");
  assert.equal(mergeCalled, false, "merge does not run on the no-pr path");
  assert.equal(
    mergeableCalled,
    false,
    "the mergeability poll must NOT run when there is nothing to land",
  );
  assert.equal(timer.calls, 0, "no waiting on the no-pr path");
});

// ── AC3: the already-merged race is preserved and takes precedence over the retry ──────────────

test("AC3: a merge that THROWS an already-merged error → alreadyMerged success, never a bounded failure", async () => {
  // The idempotent race: the PR merged between the open-PR probe and the merge, so `gh` throws
  // "already been merged". mergeable was true (the merge was attempted), yet the throw folds into
  // an alreadyMerged success — the new poll loop must not turn this into a /mergeable/i failure.
  const timer = countingSleep();

  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({
      openPrCount: async () => 1,
      mergeable: async () => true,
      merge: async () => {
        throw Object.assign(new Error("merge failed"), {
          stderr: "Pull request has already been merged",
        });
      },
    }),
    { sleep: timer.sleep },
  );

  assert.equal(res.merged, true, "an already-merged race is a success");
  assert.deepEqual(res, {
    branch: "spec/SP-tg8dsb",
    merged: true,
    opened: false,
    output: "Pull request has already been merged",
    alreadyMerged: true,
  });
  assert.equal(timer.calls, 0, "the fast-path merge attempt did not sleep");
});

test("AC3: a merge that THROWS a 'no commits between' error → alreadyMerged success (race preserved)", async () => {
  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({
      openPrCount: async () => 1,
      mergeable: async () => true,
      merge: async () => {
        throw Object.assign(new Error("merge failed"), {
          stderr: "No commits between main and spec/SP-tg8dsb",
        });
      },
    }),
    { sleep: countingSleep().sleep },
  );

  assert.equal(
    res.merged,
    true,
    "a 'no commits between' merge throw is the already-merged race, not a failure",
  );
  assert.equal(
    (res as { alreadyMerged?: boolean }).alreadyMerged,
    true,
    "the result carries alreadyMerged:true",
  );
  assert.doesNotMatch(
    (res as { output: string }).output ?? "",
    /mergeable/i,
    "the already-merged race must NOT surface as a /mergeable/i bounded failure",
  );
});
