/**
 * SP-6/14 (TEP-6) AC2 — **superseding is a deliberate, reason-carrying, content-
 * preserving transition**, driven through the REAL `supersede_spec` TOOL CALL
 * (`dispatchTool`, the layer the live MCP server runs) over a tmp `ThinkubeStore`
 * — never a helper in isolation.
 *
 * The three properties this AC pins, each against a SEEDED spec:
 *
 *   1. STAMPS MARKER + REASON — superseding a seeded spec records a durable
 *      `superseded` marker (an ISO timestamp) PLUS the given `superseded_reason`
 *      on it. Read back through `store.getFile(store.pathForSpecDoc(spec))`.
 *
 *   2. BLANK REASON REFUSED — superseding with a blank ("") or whitespace-only
 *      ("   ") reason THROWS, and the error message MENTIONS "reason". Because the
 *      spec IS seeded, the throw is reason-validation firing (not spec-not-found),
 *      and the refusal is TOTAL — the spec is left un-superseded on disk.
 *
 *   3. CONTENT-PRESERVING — a successful supersede adds EXACTLY the two fields
 *      (`superseded` + `superseded_reason`) and leaves the body string and EVERY
 *      pre-existing frontmatter key/value byte-for-value unchanged. Asserted at
 *      field level (not raw bytes — the store re-serializes the YAML block). It
 *      never writes an `accepted:` key (superseded ≠ done).
 *
 * The spec fixture is seeded with the SYMMETRIC writer named in the SPEC CONTRACT
 * (`store.writeFile(store.pathForSpecDoc(spec), frontmatter, body)`), matching
 * workingRepo.test.ts. Dispatch mirrors the existing handler-driven tests
 * (lifecycleDispatch.test.ts / specGateDispatch.test.ts): the real 4-arg
 * `dispatchTool(name, args, ctx, writeGate)` over a `{env, thinkingSpaces, promoteLocator}`
 * context with an ALLOW write-gate.
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "../mcp/kanbanMcpServer";

// ── scaffolding (mirrors lifecycleDispatch.test.ts) ──────────────────────────

const ALLOW = () => {}; // writeGate: AI writes permitted.

/** Minimal HandlerContext: `supersede_spec` resolves the store and read-modify-
 *  writes the spec doc; the promote locator is never consulted here but is
 *  constructed eagerly, so supply a harmless no-op for type parity. */
function ctxFor(store: ThinkubeStore) {
  return {
    env: {} as never,
    thinkingSpaces: { resolve: () => store } as never,
    promoteLocator: () => false,
  };
}

/** The spec id is the composite `<tep>/<spec>` in the org-scoped tree layout. */
const SPEC = "1/1";

/** A representative spec body carrying the four canonical sections — this string
 *  must survive a supersede byte-for-byte. */
const SPEC_BODY =
  "# A Retirable Spec\n\n" +
  "## Acceptance Criteria\n\n- [ ] do the thing\n\n" +
  "## Constraints\n\n- none\n\n" +
  "## Design\n\nsome design prose\n\n" +
  "## File Structure Plan\n\n- src/x.ts\n";

/** A varied set of pre-existing frontmatter fields (string / array / boolean /
 *  unknown-passthrough) — a superseded write must preserve every one untouched.
 *  Deliberately carries NO `accepted` (so we can prove supersede never adds it)
 *  and NO `superseded*` (so we can prove supersede is what adds them). */
function seedFrontmatter(): Record<string, unknown> {
  return {
    kind: "spec",
    implements: "TEP-1",
    created: "2026-01-01",
    tags: ["backlog", "cleanup"],
    archived: false,
    custom_passthrough: "preserve me verbatim",
  };
}

/** Seed the spec fixture through the SYMMETRIC writer named in the contract. */
async function seededStore(): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(path.join(os.tmpdir(), "tk-supersede-"));
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc(SPEC),
    seedFrontmatter(),
    SPEC_BODY,
  );
  return store;
}

/** Read the seeded spec back as `{ frontmatter, body }` (the contract's reader). */
async function readSpec(
  store: ThinkubeStore,
): Promise<{ frontmatter: Record<string, unknown>; body: string }> {
  const doc = await store.getFile(store.pathForSpecDoc(SPEC));
  assert.ok(doc, "the seeded spec doc must be readable through the store");
  return {
    frontmatter: (doc!.frontmatter ?? {}) as Record<string, unknown>,
    body: doc!.body,
  };
}

const supersede = (store: ThinkubeStore, reason: unknown) =>
  dispatchTool(
    "supersede_spec",
    { spec: SPEC, reason },
    ctxFor(store),
    ALLOW,
  ) as Promise<unknown>;

// ── property 1: stamps the superseded marker + the given reason ──────────────

test("supersede_spec stamps a superseded marker (ISO timestamp) plus the given reason on a seeded spec", async () => {
  const store = await seededStore();
  const reason = "obsoleted by the new streaming design";

  await supersede(store, reason);

  const { frontmatter } = await readSpec(store);

  // The durable superseded marker — a non-empty ISO timestamp (presence = superseded).
  assert.equal(
    typeof frontmatter.superseded,
    "string",
    "supersede_spec must write a `superseded` string marker",
  );
  const stamp = frontmatter.superseded as string;
  assert.ok(stamp.trim().length > 0, "the superseded marker must be non-empty");
  assert.ok(
    !Number.isNaN(Date.parse(stamp)),
    `the superseded marker must be an ISO timestamp (got: ${JSON.stringify(stamp)})`,
  );

  // The required reason, recorded verbatim.
  assert.equal(
    frontmatter.superseded_reason,
    reason,
    "supersede_spec must record the given reason in `superseded_reason`",
  );
});

// ── property 2: a blank / whitespace-only reason is refused, naming "reason" ──

for (const { label, reason } of [
  { label: "empty", reason: "" },
  { label: "whitespace-only", reason: "   " },
]) {
  test(`supersede_spec refuses a ${label} reason with an error mentioning "reason" (seeded spec ⇒ reason-validation, not not-found)`, async () => {
    const store = await seededStore();

    await assert.rejects(
      () => supersede(store, reason),
      (err: unknown) => {
        const msg = (err as Error).message;
        assert.match(
          msg,
          /reason/i,
          `the refusal must mention "reason" (got: ${msg})`,
        );
        return true;
      },
    );

    // The refusal is TOTAL: the seeded spec is left un-superseded — no marker,
    // no reason, body + fields untouched.
    const { frontmatter, body } = await readSpec(store);
    assert.equal(
      frontmatter.superseded,
      undefined,
      "a refused supersede must not stamp a superseded marker",
    );
    assert.equal(
      frontmatter.superseded_reason,
      undefined,
      "a refused supersede must not record a reason",
    );
    assert.equal(
      body,
      SPEC_BODY,
      "a refused supersede must not touch the body",
    );
    assert.deepEqual(
      frontmatter,
      seedFrontmatter(),
      "a refused supersede must leave the spec's frontmatter exactly as seeded",
    );
  });
}

// ── property 3: content-preserving — only the two fields added, nothing else ─

test("a successful supersede adds ONLY the two superseded fields and leaves the body + every other frontmatter field unchanged", async () => {
  const store = await seededStore();
  const seeded = seedFrontmatter();
  const reason = "duplicated by SP-1/7 — retiring this one";

  await supersede(store, reason);

  const { frontmatter, body } = await readSpec(store);

  // 1. The body is byte-for-byte unchanged.
  assert.equal(
    body,
    SPEC_BODY,
    "supersede must be content-preserving — the spec body must be unchanged",
  );

  // 2. EVERY pre-existing frontmatter key/value survives unchanged.
  for (const key of Object.keys(seeded)) {
    assert.deepEqual(
      frontmatter[key],
      seeded[key],
      `pre-existing frontmatter field \`${key}\` must be preserved unchanged`,
    );
  }

  // 3. EXACTLY the two superseded fields were added — no other new keys.
  const added = Object.keys(frontmatter)
    .filter((k) => !(k in seeded))
    .sort();
  assert.deepEqual(
    added,
    ["superseded", "superseded_reason"],
    "supersede must add EXACTLY `superseded` + `superseded_reason` and nothing else",
  );
  assert.equal(frontmatter.superseded_reason, reason);

  // 4. Superseded ≠ done: an `accepted:` key is NEVER written.
  assert.equal(
    "accepted" in frontmatter,
    false,
    "supersede must never write an `accepted:` key (superseded is not an acceptance-completion)",
  );
});
