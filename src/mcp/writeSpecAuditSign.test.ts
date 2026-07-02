/**
 * SP-6/1 (TEP-6) AC1 — `write_spec` runs the verifiability audit itself and signs only what its own
 * audit produced. Driven through the real `write_spec` TOOL CALL (`dispatchTool`, the layer the live
 * MCP server runs), not the helper in isolation, with the audit runner **stubbed** (`fixedAuditRunner`)
 * so the handler's enforcement is exercised in `env: local` with no live model call (Spec constraint).
 *
 * The three branches AC1 pins:
 *   1. PASS    — a passing verdict makes `write_spec` write a signed, certified `ac_verifications`:
 *                the persisted map comes from the audit's verdicts, and its `ac_verifications_signature`
 *                verifies under the server secret (and fails under a wrong one — provenance is bound).
 *   2. FAIL    — a failing (or errored) verdict makes `write_spec` refuse: it throws, names the
 *                un-verifiable AC, and persists nothing.
 *   3. NO-HONOR — an agent-supplied `ac_verifications` map (the old param path) is never honored on
 *                its own: with signing on the persisted map is the audit's, never the agent's, and an
 *                agent map cannot rescue a failing audit (no write, hence no valid signature).
 *
 * This CONSUMES the sibling units' contracts — `fixedAuditRunner` (auditorRunner.ts),
 * `verifyAcSignature` / `AC_SIGNATURE_KEY` (acSignature.ts), `acRequirementHash` (openingGate.ts) —
 * rather than re-deriving them, so a contract drift surfaces here instead of silently passing.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "./kanbanMcpServer";
import { fixedAuditRunner, type AuditRunner } from "../services/auditorRunner";
import type { AcVerdict, AcVerificationMap } from "../services/openingGate";
import { acRequirementHash } from "../services/openingGate";
import { AC_SIGNATURE_KEY, verifyAcSignature } from "../services/acSignature";

// ── scaffolding ──────────────────────────────────────────────────────────────

function freshStore(): ThinkubeStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-writespec-audit-"));
  return new ThinkubeStore(dir, dir);
}

/** The server signing secret — held only by the server process in production; here a fixed Buffer so
 *  the test is deterministic. A *different* secret stands in for "a key the agent / a forger holds". */
const SECRET = Buffer.alloc(32, 0x11);
const WRONG_SECRET = Buffer.alloc(32, 0x22);

const SPEC = "1/1";

/** A complete Spec body with all four canonical sections and exactly two acceptance criteria. */
const BODY = [
  "# Demo Spec",
  "",
  "## Acceptance Criteria",
  "",
  "- [ ] **One.** The tool does the thing, provable by a test.",
  "- [ ] **Two.** The thing is signed, provable by a test.",
  "",
  "## Constraints",
  "",
  "Some constraint.",
  "",
  "## Design",
  "",
  "Some design.",
  "",
  "## File Structure Plan",
  "",
  "- `src/foo.ts` — the thing.",
].join("\n");

/** Build a HandlerContext with signing ON: a stubbed audit runner + the server secret. */
function ctxWithAudit(store: ThinkubeStore, runner: AuditRunner) {
  return {
    env: {} as never,
    thinkingSpaces: { resolve: () => store } as never,
    promoteLocator: (() => undefined) as never,
    auditRunner: runner,
    signingSecret: SECRET,
  };
}

/** Invoke the real `write_spec` tool with certification INTENT signaled — an `ac_verifications`
 *  argument is always present (default `{}`), matching `/spec-prepare` step 7's shape and the
 *  caller-intent gate this file's tests exercise. Its VALUE is irrelevant on the signing-on path
 *  (the audit's own verdicts always win — see the NO-HONOR branch) — only its PRESENCE matters, per
 *  the regression fixed below ("REGRESSION: a body-only write_spec…"). Pass a real map to test the
 *  agent-supplied-map-is-ignored behavior specifically. */
function callWriteSpec(
  store: ThinkubeStore,
  runner: AuditRunner,
  acVerifications: Record<string, unknown> = {},
) {
  return dispatchTool(
    "write_spec",
    { spec: SPEC, body: BODY, ac_verifications: acVerifications },
    ctxWithAudit(store, runner),
    () => {},
  );
}

const PASS_VERDICTS: AcVerdict[] = [
  { ordinal: 1, verdict: "verifiable", run: "npm test -- one", env: "local" },
  { ordinal: 2, verdict: "verifiable", run: "npm test -- two", env: "local" },
];

// ── Branch 1: a passing verdict writes a signed, certified ac_verifications ────

test("PASS: write_spec writes the audit's map and a verifying server signature", async () => {
  const store = freshStore();
  await callWriteSpec(store, fixedAuditRunner(PASS_VERDICTS));

  const doc = await store.getFile(store.pathForSpecDoc(SPEC));
  assert.ok(doc, "the spec doc must be written on a passing audit");

  // The persisted map is exactly what the audit produced (ordinal → { run, env }).
  assert.deepEqual(doc!.frontmatter!.ac_verifications, {
    "1": { run: "npm test -- one", env: "local" },
    "2": { run: "npm test -- two", env: "local" },
  });

  // A provenance signature was stamped and verifies under the server secret over (AC-hash, map)...
  const sig = doc!.frontmatter![AC_SIGNATURE_KEY];
  assert.equal(typeof sig, "string");
  const acHash = acRequirementHash(BODY);
  assert.equal(
    verifyAcSignature(
      acHash,
      doc!.frontmatter!.ac_verifications as never,
      sig,
      SECRET,
    ),
    true,
    "the stamped signature must verify under the server secret",
  );

  // ...and is bound to the secret: a wrong secret does not verify it (provenance, not a plain hash).
  assert.equal(
    verifyAcSignature(
      acHash,
      doc!.frontmatter!.ac_verifications as never,
      sig,
      WRONG_SECRET,
    ),
    false,
    "the signature must not verify under a different secret",
  );
});

// ── Branch 2: a failing / errored verdict refuses and persists nothing ────────

test("FAIL: a needs-reframe verdict makes write_spec refuse and persist nothing", async () => {
  const store = freshStore();
  const failing: AcVerdict[] = [
    { ordinal: 1, verdict: "verifiable", run: "npm test -- one", env: "local" },
    { ordinal: 2, verdict: "needs-reframe", why: "a human confirms by eye" },
  ];

  await assert.rejects(
    () => callWriteSpec(store, fixedAuditRunner(failing)),
    (err: unknown) => {
      const msg = (err as Error).message;
      assert.ok(
        /audit/i.test(msg),
        `refusal must cite the audit (got: ${msg})`,
      );
      assert.ok(msg.includes("AC 2"), `refusal must name AC 2 (got: ${msg})`);
      return true;
    },
  );

  assert.equal(
    await store.getFile(store.pathForSpecDoc(SPEC)),
    undefined,
    "a refused write_spec must not create the spec doc",
  );
});

test("FAIL: an errored audit refuses (never signs), distinct from a clean fail", async () => {
  const store = freshStore();
  const errored = fixedAuditRunner([], {
    error: "audit session did not complete successfully",
  });

  await assert.rejects(
    () => callWriteSpec(store, errored),
    (err: unknown) => {
      assert.ok(/did not complete/i.test((err as Error).message));
      return true;
    },
  );
  assert.equal(await store.getFile(store.pathForSpecDoc(SPEC)), undefined);
});

// ── Branch 3: an agent-supplied ac_verifications map is never honored ─────────

test("NO-HONOR: with signing on, the persisted map is the audit's — not the agent's param", async () => {
  const store = freshStore();
  // The agent hands in a self-serving map (different commands). It must be ignored.
  const agentMap: AcVerificationMap = {
    "1": { run: "echo forged", env: "local" },
    "2": { run: "echo forged", env: "local" },
  };
  await callWriteSpec(store, fixedAuditRunner(PASS_VERDICTS), agentMap);

  const doc = await store.getFile(store.pathForSpecDoc(SPEC));
  assert.ok(doc);
  // The audit's commands win; the agent's "forged" map never reaches the frontmatter.
  assert.deepEqual(doc!.frontmatter!.ac_verifications, {
    "1": { run: "npm test -- one", env: "local" },
    "2": { run: "npm test -- two", env: "local" },
  });

  // And the signature is over the audit's map — the agent's map yields no valid signature.
  const acHash = acRequirementHash(BODY);
  assert.equal(
    verifyAcSignature(
      acHash,
      agentMap,
      doc!.frontmatter![AC_SIGNATURE_KEY],
      SECRET,
    ),
    false,
    "the signature must not validate the agent-supplied map",
  );
  assert.equal(
    verifyAcSignature(
      acHash,
      doc!.frontmatter!.ac_verifications as never,
      doc!.frontmatter![AC_SIGNATURE_KEY],
      SECRET,
    ),
    true,
  );
});

test("NO-HONOR: an agent map cannot rescue a failing audit (no write, no signature)", async () => {
  const store = freshStore();
  const perfectAgentMap = {
    "1": { run: "npm test -- one", env: "local" },
    "2": { run: "npm test -- two", env: "local" },
  };
  const failing: AcVerdict[] = [
    { ordinal: 1, verdict: "verifiable", run: "npm test -- one", env: "local" },
    { ordinal: 2, verdict: "needs-reframe", why: "a human confirms by eye" },
  ];

  await assert.rejects(() =>
    callWriteSpec(store, fixedAuditRunner(failing), perfectAgentMap),
  );
  assert.equal(
    await store.getFile(store.pathForSpecDoc(SPEC)),
    undefined,
    "an agent-supplied map must not let a failing audit through",
  );
});

// ── Audit cwd: the audit runs in the spec's WORKING repo (repo:), not the thinking space root ──
// A project-member spec's code lives in its `repo:` namespace, not under store.workspaceRoot (the
// project umbrella). The audit (and its recipe resolution) must run there — else it can't read the
// code or find package.json/repo-conventions, and fabricates a command (the `npx vitest` we hit).

test("write_spec runs the audit in the working repo resolved from repo:, not the thinking space root", async () => {
  const store = freshStore();
  let seenCwd: string | undefined;
  const recording: AuditRunner = async (req) => {
    seenCwd = req.cwd;
    return {
      verdicts: [
        { ordinal: 1, verdict: "verifiable", run: "npm test", env: "local" },
        { ordinal: 2, verdict: "verifiable", run: "npm test", env: "local" },
      ],
      passed: true,
    };
  };

  // A working repo on disk under a named workspace folder, addressed by its namespace.
  const folderRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tk-folder-"));
  const repoPath = path.join(folderRoot, "extensions", "demo-repo");
  fs.mkdirSync(repoPath, { recursive: true });
  fs.writeFileSync(path.join(repoPath, "package.json"), "{}\n");

  const ctx = {
    env: { folders: [{ name: "Plat", path: folderRoot }] } as never,
    thinkingSpaces: { resolve: () => store } as never,
    promoteLocator: (() => undefined) as never,
    auditRunner: recording,
    signingSecret: SECRET,
  };

  await dispatchTool(
    "write_spec",
    {
      spec: SPEC,
      body: BODY,
      implements: "TEP-1",
      repo: "Plat/extensions/demo-repo",
      ac_verifications: {},
    },
    ctx as never,
    () => {},
  );

  assert.equal(
    seenCwd,
    repoPath,
    "the audit cwd must be the repo: working repo, not store.workspaceRoot",
  );

  // And falling back: a spec with NO repo: audits in the thinking space repo (store.workspaceRoot).
  let seenCwd2: string | undefined;
  const recording2: AuditRunner = async (req) => {
    seenCwd2 = req.cwd;
    return { verdicts: PASS_VERDICTS, passed: true };
  };
  await dispatchTool(
    "write_spec",
    { spec: "1/2", body: BODY, implements: "TEP-1", ac_verifications: {} },
    {
      env: { folders: [] } as never,
      thinkingSpaces: { resolve: () => store } as never,
      promoteLocator: (() => undefined) as never,
      auditRunner: recording2,
      signingSecret: SECRET,
    } as never,
    () => {},
  );
  assert.equal(seenCwd2, store.workspaceRoot, "no repo: → audit in the thinking space repo");
});

// ── Caller-intent gating: a DRAFT body-only write must NOT trigger certification ──────────────
// The live bug (TEP-1 "component rebranding", a project-scoped Spec): a plain write_spec({spec,
// body}) call — the shape /spec-prepare step 4 uses to iteratively land a still-evolving AC
// checklist into the file, mid-interview, well before step 7's explicit certifying pass — landed
// non-placeholder AC bullets and unconditionally triggered the FULL audit-and-sign machinery
// (a live headless subprocess spawn), which then failed ("audit produced no parseable verdicts")
// and refused the ENTIRE draft save. The trigger must be caller INTENT (an `ac_verifications`
// argument, any value — signing ignores its content) never body content alone.

test("REGRESSION: a body-only write_spec (no ac_verifications arg) does NOT trigger the audit, even with non-empty ACs", async () => {
  const store = freshStore();
  let called = false;
  const shouldNeverRun: AuditRunner = async () => {
    called = true;
    throw new Error("the audit must not run for a body-only draft write");
  };

  const res = (await dispatchTool(
    "write_spec",
    { spec: SPEC, body: BODY }, // no `ac_verifications` key at all — a plain draft landing
    ctxWithAudit(store, shouldNeverRun),
    () => {},
  )) as { ok: boolean; acVerifications?: unknown };

  assert.equal(called, false, "the audit runner must never be invoked");
  assert.equal(res.ok, true, "the draft body must still save");
  assert.equal(
    res.acVerifications,
    undefined,
    "no certification is attempted or persisted for a body-only write",
  );

  const doc = await store.getFile(store.pathForSpecDoc(SPEC));
  assert.ok(doc, "the spec doc is written");
  assert.match(doc!.body, /Acceptance Criteria/);
  assert.equal(doc!.frontmatter?.ac_verifications, undefined);
  assert.equal(doc!.frontmatter?.[AC_SIGNATURE_KEY], undefined);
});

test("REGRESSION: a SUBSEQUENT explicit certifying write_spec still signs — the draft path doesn't disable step 7", async () => {
  const store = freshStore();
  // Step 4: land the draft (no ac_verifications) — audit must not run.
  await dispatchTool(
    "write_spec",
    { spec: SPEC, body: BODY },
    ctxWithAudit(store, () => {
      throw new Error("must not run on the draft write");
    }),
    () => {},
  );
  // Step 7: the explicit certifying call, now with `ac_verifications` present.
  await callWriteSpec(store, fixedAuditRunner(PASS_VERDICTS));

  const doc = await store.getFile(store.pathForSpecDoc(SPEC));
  assert.deepEqual(doc!.frontmatter!.ac_verifications, {
    "1": { run: "npm test -- one", env: "local" },
    "2": { run: "npm test -- two", env: "local" },
  });
  assert.equal(typeof doc!.frontmatter![AC_SIGNATURE_KEY], "string");
});
