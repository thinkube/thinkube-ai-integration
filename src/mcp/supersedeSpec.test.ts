/**
 * SP-6/14 — the transition tools `supersede_spec` / `unsupersede_spec`, driven
 * headlessly through the real `dispatchTool` (the layer the live MCP server
 * runs) over a temp-dir `ThinkubeStore`. Fixtures are seeded with the SYMMETRIC
 * writer `store.writeFile(store.pathForSpecDoc(spec), fm, body)` and read back
 * with `store.getFile(...)`.
 *
 * AC2 — `supersede_spec` stamps `superseded` (ISO) + `superseded_reason`, leaving
 *       the body and every pre-existing frontmatter key unchanged (field-level,
 *       since the store re-serializes); throws on a blank/whitespace reason with a
 *       message containing "reason".
 * AC3 — `supersede_spec` never writes an `accepted:` key; `unsupersede_spec`
 *       deletes BOTH keys, returning the Spec to `tepComplete`'s `openSpecs`.
 * Guard — `create_slice` (the spec→Ready path) refuses a superseded Spec.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import type { Frontmatter } from "../store/frontmatter";
import { dispatchTool } from "./kanbanMcpServer";
import { tepComplete } from "../methodology/tepLifecycle";

const SPEC = "1/1";

function freshStore(): ThinkubeStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-supersede-"));
  return new ThinkubeStore(dir, dir);
}

const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
});

/** Seed a spec with the symmetric writer (matches workingRepo.test.ts). */
async function seedSpec(
  store: ThinkubeStore,
  fm: Frontmatter,
  body: string,
  spec = SPEC,
): Promise<void> {
  await store.writeFile(store.pathForSpecDoc(spec), fm, body);
}

const supersede = (store: ThinkubeStore, args: Record<string, unknown>) =>
  dispatchTool("supersede_spec", args, ctxFor(store), () => {});

const unsupersede = (store: ThinkubeStore, args: Record<string, unknown>) =>
  dispatchTool("unsupersede_spec", args, ctxFor(store), () => {});

// ── AC2: stamps marker + reason, content-preserving at field level ────────────

test("AC2: supersede_spec stamps superseded + superseded_reason and preserves body + every other key", async () => {
  const store = freshStore();
  const fm: Frontmatter = {
    kind: "spec",
    implements: "TEP-1",
    created: "2026-01-01",
    tags: ["backlog"],
    ac_verifications: { "1": { run: "npm test", env: "local" } },
  };
  const body = "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n";
  await seedSpec(store, fm, body);

  const res = (await supersede(store, {
    spec: SPEC,
    reason: "replaced by SP-1/2",
  })) as { ok: boolean; superseded: string; superseded_reason: string };
  assert.equal(res.ok, true);

  const doc = await store.getFile(store.pathForSpecDoc(SPEC));
  assert.ok(doc);
  const out = doc!.frontmatter!;

  // The marker is a non-empty ISO string; the reason is exactly what we passed.
  assert.equal(typeof out.superseded, "string");
  assert.ok((out.superseded as string).length > 0);
  assert.match(out.superseded as string, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(out.superseded_reason, "replaced by SP-1/2");
  assert.equal(res.superseded, out.superseded);
  assert.equal(res.superseded_reason, "replaced by SP-1/2");

  // Body is byte-for-byte unchanged.
  assert.equal(doc!.body, body);

  // Every pre-existing key/value is preserved (field-level, not raw bytes).
  assert.equal(out.kind, "spec");
  assert.equal(out.implements, "TEP-1");
  assert.equal(out.created, "2026-01-01");
  assert.deepEqual(out.tags, ["backlog"]);
  assert.deepEqual(out.ac_verifications, {
    "1": { run: "npm test", env: "local" },
  });
});

test("AC3: supersede_spec never writes an `accepted:` key", async () => {
  const store = freshStore();
  await seedSpec(store, { kind: "spec" }, "# Spec\n");
  await supersede(store, { spec: SPEC, reason: "not building this" });
  const out = (await store.getFile(store.pathForSpecDoc(SPEC)))!.frontmatter!;
  assert.equal("accepted" in out, false, "no accepted key must be written");
});

// ── AC2: blank reason is refused (against a SEEDED spec → reason-validation fires) ──

test("AC2: supersede_spec throws (message contains 'reason') on a blank/whitespace reason", async () => {
  const store = freshStore();
  // Seed the spec first so it's NOT spec-not-found that fires — it's reason validation.
  await seedSpec(store, { kind: "spec" }, "# Spec\n");

  for (const blank of ["", "   ", "\t\n"]) {
    await assert.rejects(
      () => supersede(store, { spec: SPEC, reason: blank }),
      (err: Error) => {
        assert.match(err.message, /reason/i);
        return true;
      },
    );
  }

  // And nothing was stamped — the refused call left the frontmatter clean.
  const out = (await store.getFile(store.pathForSpecDoc(SPEC)))!.frontmatter!;
  assert.equal(out.superseded, undefined);
  assert.equal(out.superseded_reason, undefined);
});

// ── AC3: unsupersede_spec reverses to open ────────────────────────────────────

test("AC3: unsupersede_spec deletes BOTH keys, returning the Spec to openSpecs", async () => {
  const store = freshStore();
  await seedSpec(store, { kind: "spec", implements: "TEP-1" }, "# Spec\n");

  await supersede(store, { spec: SPEC, reason: "abandoned" });
  let out = (await store.getFile(store.pathForSpecDoc(SPEC)))!.frontmatter!;
  // While superseded, tepComplete excludes it (an all-superseded TEP is complete).
  assert.equal(
    tepComplete("1", [{ id: "SP-1", superseded: out.superseded as string }])
      .complete,
    true,
  );

  const res = (await unsupersede(store, { spec: SPEC })) as { ok: boolean };
  assert.equal(res.ok, true);

  out = (await store.getFile(store.pathForSpecDoc(SPEC)))!.frontmatter!;
  assert.equal("superseded" in out, false);
  assert.equal("superseded_reason" in out, false);
  // Other keys survive the reversal.
  assert.equal(out.implements, "TEP-1");
  // And it is open again — tepComplete now reports it not complete.
  assert.deepEqual(
    tepComplete("1", [{ id: "SP-1", superseded: out.superseded as string }])
      .openSpecs,
    ["SP-1"],
  );
});

// ── Guard: create_slice refuses a superseded Spec ─────────────────────────────

test("guard: create_slice refuses a superseded Spec (naming 'superseded')", async () => {
  const store = freshStore();
  // A spec that would otherwise be sliceable (AC + ac_verifications), plus a superseded stamp.
  await seedSpec(
    store,
    {
      kind: "spec",
      superseded: "2026-07-04T00:00:00Z",
      superseded_reason: "retired",
      ac_verifications: { "1": { run: "npm test" } },
    },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );

  await assert.rejects(
    () =>
      dispatchTool(
        "create_slice",
        {
          spec: SPEC,
          title: "should be refused",
          body: "detail",
          contract: "interface Contract { /* shared seam */ }",
          files: ["src/x.ts"],
        },
        ctxFor(store),
        () => {},
      ),
    (err: Error) => {
      assert.match(err.message, /superseded/i);
      return true;
    },
  );
});
