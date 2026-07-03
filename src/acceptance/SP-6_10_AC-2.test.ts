/**
 * SP-6/10 (TEP-6) AC2 — **a panel-path token satisfies the armed gate: the round-trip.**
 *
 * The two sides of the approval mechanism must provably operate on ONE
 * directory, and that directory is the one the injection seam writes:
 *
 *   env transform  ──writes──▶  THINKUBE_APPROVAL_DIR  ──read per call──▶  gate
 *   panel Approve  ──mints──▶   createApprovalStore(dir)                    ▲
 *                                        └──────── same dir ────────────────┘
 *
 * What this proves, end-to-end and headlessly:
 *
 *   1. TRANSFORM NAMES THE DIR — `mcpWithKanbanEnv(config, { approvalDir })`
 *      yields a config whose kanban-server ("thinkube-kanban") env carries
 *      `THINKUBE_APPROVAL_DIR` set to the supplied directory.
 *   2. ROUND-TRIP SUCCEEDS — with `process.env.THINKUBE_APPROVAL_DIR` set to
 *      EXACTLY the value read back out of the transformed config (never our
 *      own copy of the input — the value that actually reaches a spawned
 *      server), a token minted through SP-3's mint path (`mintApproval` over
 *      `approvalContentHash` of the CURRENT spec body, secret from
 *      `loadOrCreateApprovalSecret(dir)`, delivered via
 *      `createApprovalStore(dir).put`) satisfies `create_slice` for that spec:
 *      the call returns ok + the slice id, and the slice file exists.
 *   3. CONTENT BINDING SURVIVES THE PLUMBING — after the spec body changes,
 *      the very same stored token no longer suffices: `create_slice` is
 *      refused, the error names the missing/invalid approval, and no new
 *      slice file is created (the refusal is total).
 *
 * SP-3's own guarantees (signature, TTL, subject binding) are NOT re-verified
 * here — this test pins only the arming plumbing: the transform-named
 * directory is the directory the mint side writes into and the gate reads
 * from. It CONSUMES the SP-3 contract (`mintApproval` / `approvalContentHash` /
 * `loadOrCreateApprovalSecret` from approvalToken.ts, `createApprovalStore`
 * from approvalStore.ts) rather than re-deriving token or hash shapes, and it
 * drives the REAL tool-call layer (`dispatchTool`, the layer the live MCP
 * server runs).
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "../mcp/kanbanMcpServer";
import { mcpWithKanbanEnv } from "../services/WorktreeService";
import {
  approvalContentHash,
  loadOrCreateApprovalSecret,
  mintApproval,
} from "../services/approvalToken";
import { createApprovalStore } from "../services/approvalStore";

// ── fixture ──────────────────────────────────────────────────────────────────

// The composite `<tep>/<spec>` id and the gate's kind-namespaced subject key
// (the same derivation the SP-6_3 acceptance tests pin).
const SPEC = "1/1";
const SUBJECT_KEY = "spec:TEP-1/SP-1";

// The MCP server key the contract names for the kanban server entry.
const KANBAN_SERVER = "thinkube-kanban";

// Spec bodies: the approved content, and a materially changed revision.
const ORIGINAL_BODY =
  "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n";
const CHANGED_BODY =
  "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something ELSE entirely\n";

// Frontmatter that clears every OTHER create_slice gate (structural readyGate:
// one AC + a runnable ac_verifications entry — mirrors the SP-6_3 acceptance
// tests), so the approval gate is the only thing deciding.
const SPEC_FRONTMATTER = {
  implements: "TEP-1",
  ac_verifications: { "1": { run: "npm test" } },
};

/** A fresh thinking space seeded with a spec that passes the structural gate. */
async function seededStore(): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-sp10-ac2-thinking-space-"),
  );
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc(SPEC),
    SPEC_FRONTMATTER,
    ORIGINAL_BODY,
  );
  return store;
}

// Minimal HandlerContext (mirrors the repo's existing dispatch-test fixture
// shape): create_slice touches thinkingSpaces.resolve only.
const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
});

const createSlice = (store: ThinkubeStore, title: string) =>
  dispatchTool(
    "create_slice",
    // The pinned drive surface ({ thinking_space?, spec, title, body }) plus
    // `files` — the single-unit footprint the sibling dispatch fixtures use.
    // `thinking_space` is omitted: the fixture's resolve() ignores it.
    { spec: SPEC, title, body: "detail", files: ["src/foo.ts"] },
    ctxFor(store),
    () => {},
  );

/** Extract the kanban server's env from a transformed config. */
function kanbanEnvOf(config: Record<string, unknown>): Record<string, unknown> {
  const servers = config.mcpServers as
    Record<string, { env?: Record<string, unknown> }> | undefined;
  assert.ok(servers, "transformed config must retain mcpServers");
  const server = servers[KANBAN_SERVER];
  assert.ok(
    server,
    `transformed config must retain the ${KANBAN_SERVER} server`,
  );
  return (server.env ?? {}) as Record<string, unknown>;
}

/** Run `fn` with `process.env.THINKUBE_APPROVAL_DIR` set to `value`, restoring
 *  the previous environment afterwards. The gate reads the var PER CALL, so
 *  this scopes the arming exactly to the calls inside `fn`. */
async function withProcessApprovalDir<T>(
  value: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = process.env.THINKUBE_APPROVAL_DIR;
  process.env.THINKUBE_APPROVAL_DIR = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.THINKUBE_APPROVAL_DIR;
    else process.env.THINKUBE_APPROVAL_DIR = prev;
  }
}

// ── the round-trip ────────────────────────────────────────────────────────────

test("env transform names the approval dir; a token minted into it satisfies the armed create_slice, and stops sufficing when the spec content changes", async () => {
  const approvalDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-sp10-ac2-approval-"),
  );

  // 1 ─ TRANSFORM: given an approval directory, the kanban-server env carries
  //     THINKUBE_APPROVAL_DIR. Input mirrors a real worktree .mcp.json — the
  //     kanban server has pre-existing env that must survive.
  const inputConfig = {
    mcpServers: {
      [KANBAN_SERVER]: {
        command: "node",
        args: ["dist/mcp/kanbanMcpServer.js"],
        env: { THINKUBE_THINKING_SPACE_ROOT: "/existing/root" },
      },
    },
  };
  const transformed = mcpWithKanbanEnv(inputConfig, { approvalDir });
  const env = kanbanEnvOf(transformed);
  assert.equal(
    env.THINKUBE_APPROVAL_DIR,
    approvalDir,
    "the transform must set THINKUBE_APPROVAL_DIR on the kanban server's env to the supplied approval directory",
  );
  assert.equal(
    env.THINKUBE_THINKING_SPACE_ROOT,
    "/existing/root",
    "the transform must preserve the kanban server's pre-existing env",
  );

  // The value the round-trip arms with is READ BACK from the transformed
  // config — the exact string a spawned kanban server would receive — not our
  // local `approvalDir` variable. Any drift between the two shows up here.
  const armedValue = env.THINKUBE_APPROVAL_DIR as string;

  const store = await seededStore();

  await withProcessApprovalDir(armedValue, async () => {
    // 2 ─ MINT (the panel's Approve path, headless): secret from the SAME dir
    //     the env names, hash of the CURRENT spec body, delivered via the
    //     side-channel store over that dir.
    const doc = await store.getFile(store.pathForSpecDoc(SPEC));
    assert.ok(doc, "the seeded spec doc must exist");
    const secret = loadOrCreateApprovalSecret(armedValue);
    const token = mintApproval(
      SUBJECT_KEY,
      approvalContentHash(doc!.body),
      Date.now(),
      secret,
    );
    createApprovalStore(armedValue).put(SUBJECT_KEY, token);

    // 3 ─ GATE CLEARS: create_slice succeeds for that spec — the mint side and
    //     the gate side provably operate on the one transform-named directory.
    const res = (await createSlice(store, "armed round-trip")) as {
      ok?: boolean;
      slice: string;
    };
    assert.equal(res.ok, true, "an approved create_slice must report ok: true");
    assert.match(
      res.slice,
      /^TEP-1_SP-1_SL-\d+$/,
      "the approved create_slice must return the new slice id",
    );
    assert.equal(
      (await store.listSlices(SPEC)).length,
      1,
      "the approved create_slice must persist the slice file",
    );

    // 4 ─ CONTENT CHANGES: rewrite the spec body (frontmatter untouched, so
    //     the structural gate still passes and the approval is the only thing
    //     deciding). The token in the store is UNCHANGED.
    await store.writeFile(
      store.pathForSpecDoc(SPEC),
      SPEC_FRONTMATTER,
      CHANGED_BODY,
    );
    const changed = await store.getFile(store.pathForSpecDoc(SPEC));
    assert.notEqual(
      approvalContentHash(changed!.body),
      approvalContentHash(doc!.body),
      "sanity: the rewritten spec body must hash differently",
    );

    // 5 ─ SAME TOKEN NO LONGER SUFFICES: the armed refusal throws an error
    //     naming the missing/invalid approval, and creates no slice file.
    await assert.rejects(
      () => createSlice(store, "stale approval"),
      (err: unknown) => {
        const msg = (err as Error).message;
        assert.match(
          msg,
          /approv/i,
          `after the spec content changes, the refusal must name the missing/invalid approval (got: ${msg})`,
        );
        return true;
      },
    );
    assert.equal(
      (await store.listSlices(SPEC)).length,
      1,
      "the refusal must be total — no second slice file may be created",
    );
  });
});
