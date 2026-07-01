// createSdkAuditRunner — the local-run override (TEP-6 / SP-6/1 follow-up).
//
// The design-phase verifiability audit can't know the test FILE that will verify an AC (it doesn't
// exist yet), so the model's per-file `run` command is a fabrication — we observed `npx vitest …`
// emitted into a `node --test` repo. The runner now OVERRIDES each local `verifiable` AC's command
// with the repo's real test recipe (`defaultLocalRunResolver`), keeping verdict + env. These tests
// drive the runner with a stubbed `loadQuery` (no live model) and a stubbed `resolveLocalRun`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createSdkAuditRunner } from "./auditorRunner";

type AnyQuery = (args: unknown) => AsyncIterable<unknown>;

/** A stubbed SDK `query`: ignores args, yields one successful `result` whose text is `json` — the
 *  shape `createSdkAuditRunner` parses verdicts from. */
function fakeQuery(json: string): AnyQuery {
  return async function* () {
    yield {
      type: "result",
      subtype: "success",
      is_error: false,
      result: json,
      session_id: "sess-1",
    };
  };
}

const ACS = [
  { ordinal: 1, text: "AC one" },
  { ordinal: 2, text: "AC two" },
];

test("createSdkAuditRunner overrides a local verifiable AC's fabricated run with the repo recipe", async () => {
  // The model fabricates `node --test`-wrong commands; the override must replace them.
  const modelVerdicts = JSON.stringify([
    { ordinal: 1, verdict: "verifiable", run: "npx vitest run src/a.test.ts", env: "local" },
    { ordinal: 2, verdict: "verifiable", run: "npx vitest run src/b.test.ts" }, // env unset
  ]);
  const runner = createSdkAuditRunner({
    loadQuery: async () => fakeQuery(modelVerdicts),
    resolveLocalRun: async () => "npm test",
  });

  const res = await runner({ acs: ACS, cwd: "/repo" });

  assert.equal(res.error, undefined);
  const byOrd = new Map(res.verdicts.map((v) => [v.ordinal, v]));
  // Both local verifiable ACs now carry the repo's real recipe, env normalized to local.
  assert.equal(byOrd.get(1)?.run, "npm test");
  assert.equal(byOrd.get(1)?.env, "local");
  assert.equal(byOrd.get(2)?.run, "npm test", "an env-unset verifiable AC is treated as local");
  assert.equal(byOrd.get(2)?.env, "local");
  assert.equal(res.passed, true);
});

test("createSdkAuditRunner leaves a cluster AC's command, and needs-reframe carries no run", async () => {
  const modelVerdicts = JSON.stringify([
    { ordinal: 1, verdict: "verifiable", run: "kubectl apply -f x && check", env: "cluster" },
    { ordinal: 2, verdict: "needs-reframe", why: "a human confirms by eye" },
  ]);
  const runner = createSdkAuditRunner({
    loadQuery: async () => fakeQuery(modelVerdicts),
    resolveLocalRun: async () => "npm test",
  });

  const res = await runner({ acs: ACS, cwd: "/repo" });
  const byOrd = new Map(res.verdicts.map((v) => [v.ordinal, v]));
  // A cluster lifecycle command is the model's to name — not overridden by the local recipe.
  assert.equal(byOrd.get(1)?.run, "kubectl apply -f x && check");
  assert.equal(byOrd.get(1)?.env, "cluster");
  // needs-reframe never gets a run (the structural gate blocks it) → the audit doesn't pass.
  assert.equal(byOrd.get(2)?.run, undefined);
  assert.equal(res.passed, false);
});

test("createSdkAuditRunner leaves the model command when the repo has no test recipe", async () => {
  const modelVerdicts = JSON.stringify([
    { ordinal: 1, verdict: "verifiable", run: "node ./check.js", env: "local" },
  ]);
  const runner = createSdkAuditRunner({
    loadQuery: async () => fakeQuery(modelVerdicts),
    resolveLocalRun: async () => undefined, // no package.json `test` script
  });

  const res = await runner({ acs: [ACS[0]], cwd: "/repo" });
  // No recipe to substitute → the model's command stands as a best-effort fallback (no invention).
  assert.equal(res.verdicts[0]?.run, "node ./check.js");
});

// ── SP-6/7 AC6: a held-out acceptance/ command survives the auditor ─────────
// The verifiability auditor OVERRIDES a local verifiable AC's command with the repo recipe (npm
// test) — the design-phase fabrication fix. But a command pointing at an `acceptance/` path is the
// held-out probe the closing gate must grade INDEPENDENTLY; clobbering it to npm test is exactly
// what kept mechanism 5 from firing. So an acceptance/ command is KEPT.

test("SP-6/7 AC6: an acceptance/ command is KEPT, not overridden to the repo recipe", async () => {
  const modelVerdicts = JSON.stringify([
    { ordinal: 1, verdict: "verifiable", run: "node --test out-test/acceptance/SP-6.test.js", env: "local" },
    { ordinal: 2, verdict: "verifiable", run: "npx vitest run src/b.test.ts", env: "local" },
  ]);
  const runner = createSdkAuditRunner({
    loadQuery: async () => fakeQuery(modelVerdicts),
    resolveLocalRun: async () => "npm test",
  });
  const res = await runner({ acs: ACS, cwd: "/repo" });
  const byOrd = new Map(res.verdicts.map((v) => [v.ordinal, v]));
  // AC1's held-out acceptance/ probe survives verbatim; AC2 (an ordinary src probe) is overridden.
  assert.equal(byOrd.get(1)?.run, "node --test out-test/acceptance/SP-6.test.js");
  assert.equal(byOrd.get(2)?.run, "npm test");
  assert.equal(res.passed, true);
});

// ── SP-6/7: the auditor gains an assessment verdict (distinct from needs-reframe) ──

test("SP-6/7: an assessment verdict passes the audit, carries no run, and is not overridden", async () => {
  const modelVerdicts = JSON.stringify([
    { ordinal: 1, verdict: "verifiable", run: "npm test -- one", env: "local" },
    { ordinal: 2, verdict: "assessment", rationale: "a prose/UX quality an assessor judges" },
  ]);
  const runner = createSdkAuditRunner({
    loadQuery: async () => fakeQuery(modelVerdicts),
    resolveLocalRun: async () => "npm test",
  });
  const res = await runner({ acs: ACS, cwd: "/repo" });
  const byOrd = new Map(res.verdicts.map((v) => [v.ordinal, v]));
  // The assessment verdict is preserved (distinct from needs-reframe), carries no runnable command,
  // and keeps its rationale — and the audit PASSES (verifiable-by-assessment counts).
  assert.equal(byOrd.get(2)?.verdict, "assessment");
  assert.equal(byOrd.get(2)?.run, undefined);
  assert.match(byOrd.get(2)?.rationale ?? "", /assessor judges/);
  assert.equal(res.passed, true);
});

test("SP-6/7: a needs-reframe verdict still fails the audit (assessment did not weaken it)", async () => {
  const modelVerdicts = JSON.stringify([
    { ordinal: 1, verdict: "verifiable", run: "npm test", env: "local" },
    { ordinal: 2, verdict: "needs-reframe", why: "a human confirms by eye" },
  ]);
  const runner = createSdkAuditRunner({
    loadQuery: async () => fakeQuery(modelVerdicts),
    resolveLocalRun: async () => "npm test",
  });
  const res = await runner({ acs: ACS, cwd: "/repo" });
  assert.equal(res.passed, false);
});
