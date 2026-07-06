/**
 * SP-6/13 (TEP-6) AC2 — **the create→merge-race retry is BOUNDED and never hangs.**
 *
 * When Accept lands a Spec, `mergeSpecPr` opens the PR then immediately merges — but
 * GitHub computes a fresh PR's mergeability asynchronously, so the merge now polls
 * `PrOps.mergeable(branch, cwd)` up to `maxAttempts` before giving up. AC2 pins the
 * FAILURE side of that bound: a PR whose `mergeable` stays `false` for the entire
 * bound must NOT spin forever and must NOT fall through to `ops.merge` — it must
 * surface a clear un-mergeable error within a predictable ceiling.
 *
 * Everything is driven through the injected seams named in the SPEC CONTRACT — a
 * counting no-op `sleep` and a scripted `mergeable` probe — so there is no real
 * waiting and no live network:
 *
 *   1. BOUNDED FAILURE — with `openPrCount ⇒ 1` (reach the poll) and a small injected
 *      `maxAttempts`, an always-`false` `mergeable` makes `mergeSpecPr` REJECT, and the
 *      rejection's message matches `/mergeable/i` (the pinned bounded-failure token,
 *      identifying un-mergeability rather than a generic failure).
 *   2. EXACTLY `maxAttempts - 1` DELAYS — the injected `sleep` is called exactly
 *      `maxAttempts - 1` times (a sleep between each of the N polls, none after the
 *      last), the pinned delay-accounting for always-false. This is the "never hangs"
 *      guarantee made concrete: a fixed ceiling of tries, not an unbounded spin.
 *   3. `ops.merge` IS NEVER CALLED — the retry keys off the explicit `mergeable`
 *      boolean, so a never-mergeable PR never reaches the merge step at all; the
 *      failure comes from the exhausted bound, not from `merge` throwing.
 *
 * These exercise ONLY the public `mergeSpecPr(spec, cwd, ops?, opts?)` surface: a fake
 * `PrOps` scripts `mergeable`, and `opts.sleep` / `opts.maxAttempts` inject the seams.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeSpecPr, PrOps } from "../github/specMerge";

/**
 * A PrOps with safe defaults that REACH the merge poll: an open PR exists
 * (`openPrCount ⇒ 1`), so `mergeSpecPr` goes straight to the mergeability poll.
 * `mergeable` defaults to always-false (the AC2 subject); override per test.
 * `merge` records if it was ever called — for an always-false PR it must NOT be.
 */
function ops(over: Partial<PrOps> = {}): PrOps {
  return {
    openPrCount: async () => 1,
    unmergedCommits: async () => 0,
    openPr: async () => {},
    mergeable: async () => false,
    merge: async () => "should not happen",
    ...over,
  };
}

// A counting no-op sleep — the injected delay seam. Records every call so the test
// asserts the exact number of delays (no real waiting).
function countingSleep() {
  let calls = 0;
  return {
    fn: async (_ms: number): Promise<void> => {
      calls += 1;
    },
    calls: () => calls,
  };
}

// ── property 1 + 2 + 3, together for one dispatch: bounded reject, exact delays, no merge ──

test("mergeable stays false through the whole bound → rejects /mergeable/i after exactly maxAttempts-1 sleeps, never calling merge", async () => {
  const MAX_ATTEMPTS = 4;
  const sleep = countingSleep();
  let mergeCalled = false;

  await assert.rejects(
    mergeSpecPr(
      "tg8dsb",
      "/repo",
      ops({
        openPrCount: async () => 1, // an open PR exists → reach the mergeability poll
        mergeable: async () => false, // never becomes mergeable, through the whole bound
        merge: async () => {
          mergeCalled = true;
          return "should not happen";
        },
      }),
      { sleep: sleep.fn, maxAttempts: MAX_ATTEMPTS },
    ),
    /mergeable/i,
    "an always-not-mergeable PR must reject with an error identifying un-mergeability (matches /mergeable/i)",
  );

  assert.equal(
    sleep.calls(),
    MAX_ATTEMPTS - 1,
    `always-false with maxAttempts=${MAX_ATTEMPTS} must sleep exactly ${MAX_ATTEMPTS - 1} times — a sleep between each poll, none after the last (the pinned delay accounting)`,
  );
  assert.equal(
    mergeCalled,
    false,
    "ops.merge must NEVER run for a never-mergeable PR — the failure comes from the exhausted bound, not from merge throwing",
  );
});

// ── property 2 restated at a different bound: the count TRACKS maxAttempts (not a constant) ──

test("the exact-delay accounting scales with the injected bound (maxAttempts=2 → exactly 1 sleep)", async () => {
  const MAX_ATTEMPTS = 2;
  const sleep = countingSleep();

  await assert.rejects(
    mergeSpecPr(
      "tg8dsb",
      "/repo",
      ops({ openPrCount: async () => 1, mergeable: async () => false }),
      { sleep: sleep.fn, maxAttempts: MAX_ATTEMPTS },
    ),
    /mergeable/i,
  );

  assert.equal(
    sleep.calls(),
    MAX_ATTEMPTS - 1,
    "the delay count must be maxAttempts-1 at every bound (here 1), proving it is wired to the injected bound and not a hardcoded constant",
  );
});

// ── the "never hangs" guarantee made concrete: mergeable is polled a bounded number of times ──

test("mergeable is polled a bounded number of times (never an unbounded spin)", async () => {
  const MAX_ATTEMPTS = 5;
  const sleep = countingSleep();
  let mergeablePolls = 0;

  await assert.rejects(
    mergeSpecPr(
      "tg8dsb",
      "/repo",
      ops({
        openPrCount: async () => 1,
        mergeable: async () => {
          mergeablePolls += 1;
          return false;
        },
      }),
      { sleep: sleep.fn, maxAttempts: MAX_ATTEMPTS },
    ),
    /mergeable/i,
  );

  assert.ok(
    mergeablePolls >= 1 && mergeablePolls <= MAX_ATTEMPTS,
    `mergeable must be polled at least once and never more than maxAttempts (${MAX_ATTEMPTS}) times — got ${mergeablePolls}; the loop is bounded and terminates`,
  );
  assert.equal(
    sleep.calls(),
    MAX_ATTEMPTS - 1,
    "and the injected sleep is called exactly maxAttempts-1 times regardless — a fixed ceiling, never a hang",
  );
});
