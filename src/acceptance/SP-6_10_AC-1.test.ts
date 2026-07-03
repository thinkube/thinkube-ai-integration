/**
 * SP-6/10 (TEP-6) AC1 — the injection seam sets the approval dir, and the
 * worktree lifecycle applies it.
 *
 * Two halves, exactly as the AC splits them:
 *
 *   1. PURE TRANSFORM — `mcpWithKanbanEnv(config, { thinkingSpaceRoot, approvalDir })`
 *      sets `THINKUBE_APPROVAL_DIR` (to the supplied approval-storage directory)
 *      alongside `THINKUBE_THINKING_SPACE_ROOT` on the kanban server's env — one
 *      variable per provided field — preserving all other env keys and all other
 *      servers; a config without the kanban server entry ("thinkube-kanban") is
 *      returned unchanged. The pre-existing `mcpWithThinkingSpaceRoot` remains a
 *      delegating alias.
 *
 *   2. LIFECYCLE (real-git fixture, no mocks) — `WorktreeService.create(...)`
 *      called with an approval dir produces a worktree whose `.mcp.json` carries
 *      `THINKUBE_APPROVAL_DIR`, and `reset(...)` re-applies it after the
 *      `reset --hard` reverts the machine-local edit. Causality is pinned by an
 *      interleaved no-args reset: it strips the variable (proving create's edit
 *      is uncommitted and reverted), so its presence after the armed reset can
 *      only come from the reset path's own injection.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  mcpWithKanbanEnv,
  mcpWithThinkingSpaceRoot,
  WorktreeService,
} from "../services/WorktreeService";

const KANBAN = "thinkube-kanban";

/** A representative parsed `.mcp.json`: the kanban server with pre-existing env,
 *  plus an unrelated server — both must survive the transform untouched. */
function sampleConfig(): Record<string, unknown> {
  return {
    mcpServers: {
      [KANBAN]: {
        command: "node",
        args: ["kanban.js"],
        env: { THINKUBE_ROOTS: "/a:/b" },
      },
      "other-server": { command: "other", env: { X: "1" } },
    },
    unknownTopLevelField: { keep: true },
  };
}

type EnvOf = {
  mcpServers: Record<
    string,
    { env?: Record<string, string> } & Record<string, unknown>
  >;
};

// ── 1. The pure transform ────────────────────────────────────────────────────

test("mcpWithKanbanEnv sets THINKUBE_APPROVAL_DIR alongside THINKUBE_THINKING_SPACE_ROOT on the kanban server env", () => {
  const input = sampleConfig();
  const out = mcpWithKanbanEnv(input, {
    thinkingSpaceRoot: "/home/u/thinking-space",
    approvalDir: "/home/u/globalStorage/approvals",
  }) as unknown as EnvOf;

  const env = out.mcpServers[KANBAN].env!;
  assert.equal(
    env.THINKUBE_APPROVAL_DIR,
    "/home/u/globalStorage/approvals",
    "the approval dir must land verbatim in THINKUBE_APPROVAL_DIR",
  );
  assert.equal(
    env.THINKUBE_THINKING_SPACE_ROOT,
    "/home/u/thinking-space",
    "the thinking-space root rides alongside — one transform, two variables",
  );
  // Pre-existing env on the kanban server is preserved…
  assert.equal(env.THINKUBE_ROOTS, "/a:/b");
  // …the kanban server's non-env fields survive…
  assert.equal(out.mcpServers[KANBAN].command, "node");
  assert.deepEqual(out.mcpServers[KANBAN].args, ["kanban.js"]);
  // …other servers are untouched…
  assert.deepEqual(out.mcpServers["other-server"], {
    command: "other",
    env: { X: "1" },
  });
  // …and unknown top-level fields pass through.
  assert.deepEqual(
    (out as unknown as Record<string, unknown>).unknownTopLevelField,
    { keep: true },
  );
});

test("mcpWithKanbanEnv is pure: the input config is not mutated", () => {
  const input = sampleConfig();
  mcpWithKanbanEnv(input, {
    thinkingSpaceRoot: "/ts",
    approvalDir: "/ap",
  });
  const inputEnv = (input as unknown as EnvOf).mcpServers[KANBAN].env!;
  assert.equal(inputEnv.THINKUBE_APPROVAL_DIR, undefined);
  assert.equal(inputEnv.THINKUBE_THINKING_SPACE_ROOT, undefined);
  assert.deepEqual(input, sampleConfig(), "the original object is unchanged");
});

test("mcpWithKanbanEnv sets one variable per PROVIDED field — approvalDir alone neither sets nor clobbers the thinking-space root", () => {
  // approvalDir only, against a config whose kanban env ALREADY carries a root:
  // the root must survive untouched (not be overwritten or deleted).
  const input = {
    mcpServers: {
      [KANBAN]: {
        command: "node",
        env: { THINKUBE_THINKING_SPACE_ROOT: "/existing/root" },
      },
    },
  };
  const out = mcpWithKanbanEnv(input, {
    approvalDir: "/only/approval",
  }) as unknown as EnvOf;
  const env = out.mcpServers[KANBAN].env!;
  assert.equal(env.THINKUBE_APPROVAL_DIR, "/only/approval");
  assert.equal(
    env.THINKUBE_THINKING_SPACE_ROOT,
    "/existing/root",
    "an omitted field must not touch its variable",
  );

  // thinkingSpaceRoot only: no THINKUBE_APPROVAL_DIR appears.
  const rootOnly = mcpWithKanbanEnv(sampleConfig(), {
    thinkingSpaceRoot: "/just/root",
  }) as unknown as EnvOf;
  const rootEnv = rootOnly.mcpServers[KANBAN].env!;
  assert.equal(rootEnv.THINKUBE_THINKING_SPACE_ROOT, "/just/root");
  assert.equal(
    rootEnv.THINKUBE_APPROVAL_DIR,
    undefined,
    "an omitted approvalDir must not invent the variable",
  );
});

test("mcpWithKanbanEnv leaves a config without the kanban server entry unchanged", () => {
  // mcpServers present, but no "thinkube-kanban" key.
  const noKanban = {
    mcpServers: { "other-server": { command: "other", env: { X: "1" } } },
    extra: 42,
  };
  assert.deepEqual(
    mcpWithKanbanEnv(noKanban, {
      thinkingSpaceRoot: "/ts",
      approvalDir: "/ap",
    }),
    noKanban,
    "no kanban entry → returned unchanged",
  );

  // No mcpServers at all.
  const bare = { schemaVersion: 1 };
  assert.deepEqual(
    mcpWithKanbanEnv(bare, { approvalDir: "/ap" }),
    bare,
    "no mcpServers → returned unchanged",
  );
});

test("mcpWithThinkingSpaceRoot remains a delegating alias (existing call sites keep working)", () => {
  const out = mcpWithThinkingSpaceRoot(
    sampleConfig(),
    "/legacy/root",
  ) as unknown as EnvOf;
  assert.equal(
    out.mcpServers[KANBAN].env!.THINKUBE_THINKING_SPACE_ROOT,
    "/legacy/root",
  );
  // Alias sets only its one variable — the approval dir was not supplied.
  assert.equal(out.mcpServers[KANBAN].env!.THINKUBE_APPROVAL_DIR, undefined);
  // Other env still preserved through the delegation.
  assert.equal(out.mcpServers[KANBAN].env!.THINKUBE_ROOTS, "/a:/b");
});

// ── 2. The lifecycle applies it (real git, real files) ───────────────────────

/** Seed a repo whose COMMITTED `.mcp.json` declares the kanban server (with
 *  pre-existing env) plus an unrelated server — the shape a thinking-space
 *  repo actually ships. */
function initRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tk-sp610-ac1-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(
    path.join(repo, ".mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          [KANBAN]: {
            command: "node",
            args: ["kanban.js"],
            env: { THINKUBE_ROOTS: "/a:/b" },
          },
          "other-server": { command: "other" },
        },
      },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(path.join(repo, "README.md"), "seed\n");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return repo;
}

function readMcp(worktree: string): EnvOf {
  return JSON.parse(
    fs.readFileSync(path.join(worktree, ".mcp.json"), "utf8"),
  ) as EnvOf;
}

test("a worktree CREATED with an approval dir carries THINKUBE_APPROVAL_DIR in its .mcp.json, and RESET re-applies it", async () => {
  const repo = initRepo();
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tk-sp610-ac1-wts-"));
  const thinkingSpaceRoot = "/home/u/central-thinking-space";
  const approvalDir = "/home/u/globalStorage/thinkube.approvals";
  const svc = new WorktreeService();

  try {
    // CREATE with both machine-local values.
    const wt = await svc.create(
      repo,
      "6/10",
      wtRoot,
      thinkingSpaceRoot,
      approvalDir,
    );
    let env = readMcp(wt).mcpServers[KANBAN].env!;
    assert.equal(
      env.THINKUBE_APPROVAL_DIR,
      approvalDir,
      "create must inject the approval dir into the worktree's .mcp.json",
    );
    assert.equal(
      env.THINKUBE_THINKING_SPACE_ROOT,
      thinkingSpaceRoot,
      "the thinking-space root is injected alongside at the same call site",
    );
    assert.equal(
      env.THINKUBE_ROOTS,
      "/a:/b",
      "committed kanban env survives the injection",
    );
    assert.deepEqual(
      readMcp(wt).mcpServers["other-server"],
      { command: "other" },
      "other servers in the worktree's .mcp.json are preserved",
    );

    // Causality probe: a no-args reset reverts .mcp.json to its COMMITTED
    // content — the injection from create was uncommitted, so it disappears.
    await svc.reset(wt);
    env = readMcp(wt).mcpServers[KANBAN].env!;
    assert.equal(
      env.THINKUBE_APPROVAL_DIR,
      undefined,
      "reset --hard reverts the machine-local injection (it is never committed)",
    );

    // RESET with the approval dir: the variable is back — this presence can
    // only come from the reset path's own injection, not a leftover of create.
    await svc.reset(wt, thinkingSpaceRoot, approvalDir);
    env = readMcp(wt).mcpServers[KANBAN].env!;
    assert.equal(
      env.THINKUBE_APPROVAL_DIR,
      approvalDir,
      "reset must re-inject the approval dir it was given",
    );
    assert.equal(
      env.THINKUBE_THINKING_SPACE_ROOT,
      thinkingSpaceRoot,
      "reset re-injects the thinking-space root alongside",
    );
    assert.equal(env.THINKUBE_ROOTS, "/a:/b");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(wtRoot, { recursive: true, force: true });
  }
});

test("the machine-local injection stays UNCOMMITTED: .mcp.json is the only dirt in a freshly created armed worktree", async () => {
  const repo = initRepo();
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tk-sp610-ac1-wts2-"));
  const svc = new WorktreeService();
  try {
    const wt = await svc.create(repo, "6/11", wtRoot, "/ts-root", "/appr-dir");
    const porcelain = execFileSync("git", ["-C", wt, "status", "--porcelain"], {
      stdio: "pipe",
    }).toString();
    const dirty = porcelain
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "")
      .map((l) => l.slice(3).replace(/^"(.*)"$/, "$1"));
    assert.deepEqual(
      dirty,
      [".mcp.json"],
      "the injection is a local edit to .mcp.json and nothing else — never committed",
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(wtRoot, { recursive: true, force: true });
  }
});
