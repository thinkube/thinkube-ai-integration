/**
 * SP-6/14 (TEP-6) AC3 — "Superseded is distinct from done, and is reversible."
 *
 * Two facts, exactly as the AC splits them:
 *
 *   1. NEVER ACCEPTED — superseding a seeded spec stamps the `superseded` marker
 *      + its `superseded_reason`, but NEVER writes an `accepted:` key. Superseded
 *      is a deliberate retirement, not an acceptance-completion; a superseded
 *      spec must never read as "done".
 *
 *   2. REVERSIBLE — the named inverse transition `unsupersede_spec` deletes BOTH
 *      the `superseded` marker AND its `superseded_reason`, returning the spec to
 *      the OPEN backlog: `tepComplete` counts it as open again (`complete` flips
 *      back to false) exactly as before it was superseded.
 *
 * Driven headlessly through the REAL exported `dispatchTool` — the layer the live
 * MCP server runs — over a real `ThinkubeStore` on a temp dir (mirrors
 * `lifecycleDispatch.test.ts` / `specGateDispatch.test.ts`), NOT a helper in
 * isolation. The fixture spec is seeded with the SYMMETRIC writer
 * `store.writeFile(store.pathForSpecDoc(spec), frontmatter, body)` and read back
 * with `store.getFile(...) -> { frontmatter, body }`.
 *
 * "Returns to the open backlog" is pinned against the CONTRACT's pure backlog
 * surface: the spec's stored frontmatter is projected to an `ImplementingSpec`
 * (`{ id, accepted, superseded }`, exactly what `getProject` /
 * `implementingSpecsOfTep` project) and fed to `tepComplete` — so the store-state
 * change is proven to move the spec in/out of `openSpecs`, not merely to toggle a
 * field.
 *
 * installVscodeStub MUST be imported first: `kanbanMcpServer` installs the
 * require-hook that redirects `require('vscode')` to the subprocess stub.
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "../mcp/kanbanMcpServer";
import {
  isSuperseded,
  tepComplete,
  type ImplementingSpec,
} from "../methodology/tepLifecycle";

// ── fixture scaffolding ──────────────────────────────────────────────────────

// The composite `<tep>/<spec>` id in the org-scoped tree layout (as in
// lifecycleDispatch.test.ts / specGateDispatch.test.ts).
const SPEC = "1/1";
const TEP = "TEP-1";

// Pre-existing frontmatter on the seeded spec, plus the body — both must survive
// a supersede/unsupersede round-trip untouched (only the two superseded fields
// may ever be added/removed; an `accepted:` key must NEVER appear).
const SEED_FRONTMATTER = { implements: TEP } as const;
const SEED_BODY =
  "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] the widget turns blue\n";

/** A fresh tmp thinking-space store seeded with the fixture spec via the
 *  symmetric writer named in the contract. */
async function seededStore(): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(path.join(os.tmpdir(), "tk-sp614-ac3-"));
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc(SPEC),
    { ...SEED_FRONTMATTER },
    SEED_BODY,
  );
  return store;
}

/** Minimal HandlerContext for the supersede/unsupersede dispatches — mirrors the
 *  `ctxFor` used by the other dispatch tests (the store is the only real seam;
 *  `promoteLocator` is a harmless no-op these tools never consult). */
const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
  promoteLocator: (() => false) as never,
});

const ALLOW = () => {}; // writeGate: AI writes permitted.

/** Read the seeded spec's stored frontmatter back through the store. */
async function readFrontmatter(
  store: ThinkubeStore,
): Promise<Record<string, unknown>> {
  const doc = await store.getFile(store.pathForSpecDoc(SPEC));
  assert.ok(doc, "the seeded spec must be readable through the store");
  return (doc!.frontmatter ?? {}) as Record<string, unknown>;
}

/** Project the stored frontmatter down to the CONTRACT's `ImplementingSpec`
 *  shape — precisely what `getProject` / `implementingSpecsOfTep` project before
 *  handing specs to `tepComplete`. Reads `accepted` AND `superseded`. */
function projectSpec(fm: Record<string, unknown>): ImplementingSpec {
  return {
    id: SPEC,
    accepted: fm.accepted as string | undefined,
    superseded: fm.superseded as string | undefined,
  };
}

// ── AC3.1 — superseding never marks the spec accepted / done ──────────────────

test("supersede_spec stamps the superseded marker + reason but NEVER writes an `accepted:` key", async () => {
  const store = await seededStore();

  // Sanity: the seed is neither accepted nor superseded to begin with.
  const before = await readFrontmatter(store);
  assert.ok(!("accepted" in before), "seed must start un-accepted");
  assert.ok(!("superseded" in before), "seed must start un-superseded");

  const reason = "requirement dropped — superseded by TEP-9's approach";
  await dispatchTool(
    "supersede_spec",
    { spec: SPEC, reason },
    ctxFor(store),
    ALLOW,
  );

  const fm = await readFrontmatter(store);

  // The two superseded fields are stamped…
  assert.equal(
    typeof fm.superseded,
    "string",
    "supersede_spec must stamp `superseded` as an ISO string",
  );
  assert.ok(
    (fm.superseded as string).trim().length > 0,
    "the `superseded` stamp must be a non-empty string",
  );
  assert.equal(
    fm.superseded_reason,
    reason,
    "supersede_spec must record the given reason verbatim in `superseded_reason`",
  );

  // …but NO `accepted:` key is ever written — this is the crux of AC3: superseded
  // is DISTINCT from done, and is never counted as an acceptance-completion.
  assert.ok(
    !("accepted" in fm),
    "supersede_spec must NEVER write an `accepted:` key (superseded ≠ done)",
  );

  // The CONTRACT's classifiers agree: the projected spec reads as superseded,
  // and — having no `accepted` stamp — is NOT an acceptance-completion.
  const projected = projectSpec(fm);
  assert.equal(
    isSuperseded(projected),
    true,
    "isSuperseded must be true once the spec carries a non-empty `superseded`",
  );
  assert.ok(
    !projected.accepted,
    "a superseded spec must carry no `accepted` stamp in its projection",
  );

  // Pre-existing frontmatter + body survive: only the two superseded fields were
  // added, and — again — no `accepted` stamp slipped in.
  assert.equal(
    fm.implements,
    TEP,
    "pre-existing frontmatter (`implements`) must survive the supersede",
  );
  const doc = await store.getFile(store.pathForSpecDoc(SPEC));
  assert.equal(doc!.body, SEED_BODY, "the spec body must be left unchanged");
});

// ── AC3.2 — the inverse clears both fields and returns the spec to the backlog ─

test("unsupersede_spec removes BOTH the superseded marker and its reason, returning the spec to the open backlog", async () => {
  const store = await seededStore();

  // Supersede first (through the real tool), then confirm the spec has LEFT the
  // open backlog: as the sole implementing spec of TEP-1, an all-superseded TEP
  // reports complete=true with an empty openSpecs (per the contract).
  const reason = "abandoned — folding this into another spec";
  await dispatchTool(
    "supersede_spec",
    { spec: SPEC, reason },
    ctxFor(store),
    ALLOW,
  );

  const superseded = await readFrontmatter(store);
  const outOfBacklog = tepComplete(TEP, [projectSpec(superseded)]);
  assert.deepEqual(
    outOfBacklog.openSpecs,
    [],
    "a superseded spec must be excluded from openSpecs (off the backlog)",
  );
  assert.equal(
    outOfBacklog.complete,
    true,
    "an all-superseded TEP reports complete — the spec is resolved, not open",
  );

  // Now the INVERSE transition.
  await dispatchTool("unsupersede_spec", { spec: SPEC }, ctxFor(store), ALLOW);

  const fm = await readFrontmatter(store);

  // Both superseded fields are gone…
  assert.ok(
    !("superseded" in fm),
    "unsupersede_spec must delete the `superseded` marker",
  );
  assert.ok(
    !("superseded_reason" in fm),
    "unsupersede_spec must delete the `superseded_reason`",
  );
  assert.equal(
    isSuperseded(projectSpec(fm)),
    false,
    "isSuperseded must be false again once the marker is cleared",
  );

  // …and the reversal is content-preserving: the body and pre-existing keys stay,
  // and — as throughout — no `accepted:` stamp was ever introduced.
  assert.equal(
    fm.implements,
    TEP,
    "pre-existing frontmatter must survive the reversal",
  );
  assert.ok(
    !("accepted" in fm),
    "unsupersede_spec must not write an `accepted:` key either",
  );
  const doc = await store.getFile(store.pathForSpecDoc(SPEC));
  assert.equal(
    doc!.body,
    SEED_BODY,
    "the reversal must leave the body unchanged",
  );

  // The spec is BACK on the open backlog: it re-enters openSpecs and the TEP is
  // incomplete again — the exact inverse of the superseded state above.
  const backOnBacklog = tepComplete(TEP, [projectSpec(fm)]);
  assert.deepEqual(
    backOnBacklog.openSpecs,
    [SPEC],
    "the reversed spec must return to openSpecs (back on the backlog)",
  );
  assert.equal(
    backOnBacklog.complete,
    false,
    "with the spec re-opened, the TEP is incomplete again",
  );
});
