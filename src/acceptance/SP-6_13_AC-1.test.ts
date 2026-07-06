/**
 * SP-6/13 (TEP-6) AC1 — Accept's merge survives the create→merge race.
 *
 * A freshly-created PR's mergeability is computed asynchronously by GitHub, so a `gh pr merge`
 * fired immediately after `gh pr create` can report "not mergeable yet" even though the PR is
 * perfectly fine seconds later. The fix makes `mergeSpecPr` POLL a new `PrOps.mergeable` probe
 * before the merge: while it reports `false`, the merge awaits an injected `sleep` and re-polls
 * (up to `maxAttempts`), rather than throwing on the first not-mergeable result.
 *
 * This AC pins the *eventual-merge* path: `mergeable` is `false` for the first few polls and
 * `true` thereafter (within the attempt bound) ⇒ the PR is merged. The probe asserts the two
 * observables the SPEC CONTRACT exposes: at least one injected `sleep` call happened (the retry
 * waited instead of throwing), and the result is `merged: true`.
 *
 * It exercises ONLY the public interface in the SPEC CONTRACT (`mergeSpecPr`, `PrOps.mergeable`,
 * the injected `opts.sleep` / `opts.maxAttempts` seams) — it makes NO assumption about the
 * internal implementation of the poll loop.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeSpecPr, PrOps } from "../github/specMerge";

/**
 * A PrOps with safe defaults for the open-PR merge path: one open PR (so we reach the merge),
 * nothing to open, a no-op merge, and `mergeable` defaulting to `true`. Override per test —
 * in particular `mergeable` is scripted to model the async-mergeability race.
 */
function ops(over: Partial<PrOps> = {}): PrOps {
  return {
    openPrCount: async () => 1, // an open PR exists ⇒ reach the merge/poll step
    unmergedCommits: async () => 0,
    openPr: async () => {},
    merge: async () => "",
    mergeable: async () => true,
    ...over,
  };
}

/**
 * A counting no-op sleep — records each call so the probe can assert the retry actually waited
 * (rather than throwing on the first not-mergeable result). No real timer, no waiting.
 */
function countingSleep(): {
  sleep: (ms: number) => Promise<void>;
  calls: () => number;
} {
  let n = 0;
  return {
    sleep: async () => {
      n += 1;
    },
    calls: () => n,
  };
}

test("AC1: mergeable false for the first few polls then true → polls + sleeps between retries (≥1 sleep) and returns merged:true", async () => {
  // Script `mergeable`: false, false, then true — the PR settles on the third poll, well within
  // the bound. Each false-then-retry must `await sleep(...)`, so at least one sleep call happens.
  const results = [false, false, true];
  let pollIndex = 0;
  let mergeCalled = 0;
  const { sleep, calls } = countingSleep();

  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({
      openPrCount: async () => 1, // reach the poll (an open PR exists)
      mergeable: async () => {
        const next = results[pollIndex] ?? true;
        pollIndex += 1;
        return next;
      },
      merge: async () => {
        mergeCalled += 1;
        return "Merged PR #66";
      },
    }),
    { sleep, maxAttempts: 5 },
  );

  // The merge is NOT thrown away on the first not-mergeable result — it waits and retries.
  assert.ok(
    calls() >= 1,
    "the retry must await the injected sleep between not-mergeable polls (at least one sleep call)",
  );

  // …and once the PR becomes mergeable, it merges exactly once and reports success.
  assert.equal(res.merged, true, "an eventually-mergeable PR must be merged");
  assert.equal(
    mergeCalled,
    1,
    "merge runs exactly once, after the PR reports mergeable",
  );
});

test("AC1: exactly K sleep calls when mergeable is false K times then true (delay accounting pinned)", async () => {
  // The SPEC CONTRACT pins the delay accounting: mergeable false K-times-then-true ⇒ exactly K
  // sleep calls. Here K=2 (false, false, true) — two waits precede the successful merge.
  const K = 2;
  const results = [false, false, true];
  let pollIndex = 0;
  const { sleep, calls } = countingSleep();

  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({
      openPrCount: async () => 1,
      mergeable: async () => {
        const next = results[pollIndex] ?? true;
        pollIndex += 1;
        return next;
      },
      merge: async () => "Merged PR #66",
    }),
    { sleep, maxAttempts: 5 },
  );

  assert.equal(res.merged, true, "the PR lands once it becomes mergeable");
  assert.equal(
    calls(),
    K,
    `mergeable false ${K} times then true ⇒ exactly ${K} injected sleep calls`,
  );
});

test("AC1: an eventually-mergeable PR returns the full open-PR success shape (merged:true, opened:false)", async () => {
  // The merge-step change must preserve the existing open-PR success shape — merging an existing
  // PR opens nothing and surfaces the merge stdout.
  const results = [false, true];
  let pollIndex = 0;
  const { sleep } = countingSleep();

  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({
      openPrCount: async () => 1,
      mergeable: async () => {
        const next = results[pollIndex] ?? true;
        pollIndex += 1;
        return next;
      },
      merge: async () => "Merged PR #66",
    }),
    { sleep, maxAttempts: 5 },
  );

  assert.deepEqual(res, {
    branch: "spec/SP-tg8dsb",
    merged: true,
    opened: false,
    output: "Merged PR #66",
  });
});
