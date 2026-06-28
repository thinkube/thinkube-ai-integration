#!/usr/bin/env node
/**
 * stdio harness for SP-8_SL-1 — reading/writing a thinking space from a central root.
 *
 * Spawns the real kanban MCP server with a central thinking space root (no co-located
 * `.thinkube/` in the code repo) and proves, end-to-end:
 *
 *   1. the server DISCOVERS the thinking space at `<thinking-space-root>/<container>/<rel>` and
 *      list_thinking_space reads its seeded slice (AC #1, #3)
 *   2. create_slice WRITES under that central namespace, and the code repo
 *      stays clean — no `.thinkube/` appears in it (AC #2)
 *
 * Build first: `npm run compile`. Run: `node scripts/central-thinking-space-harness.mjs`.
 * Exit 0 = all behaviours held.
 */
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const SERVER = path.join(REPO, "dist", "mcp", "kanbanMcpServer.js");

// ── temp layout: a "Platform" workspace folder holding a code repo with a
//    .git but NO .thinkube; a separate central thinking space root holding its thinking space ──
const tmp = mkdtempSync(path.join(tmpdir(), "central-thinking-space-"));
const wsFolder = path.join(tmp, "ws"); // the "Platform" workspace folder
const repo = path.join(wsFolder, "extensions", "foo"); // the code repo
const thinkingSpaceRoot = path.join(tmp, "thinking space"); // the central sidecar root
const ns = path.join("Platform", "extensions", "foo"); // <container>/<rel>
const thinkingSpaceDir = path.join(thinkingSpaceRoot, ns);
const specDir = path.join(thinkingSpaceDir, "specs", "SP-1");

mkdirSync(path.join(repo, ".git"), { recursive: true }); // repo, no .thinkube
mkdirSync(specDir, { recursive: true });
writeFileSync(
  path.join(specDir, "spec.md"),
  `# Foo spec\n\nA seeded central thinking space.\n\n## Acceptance Criteria\n\n- [ ] something\n\n## Constraints\n\n- none\n\n## Design\n\n- n/a\n\n## File Structure Plan\n\n- n/a\n`,
);
writeFileSync(
  path.join(specDir, "SL-1.md"),
  `---\nuid: seed-slice\nparent: SP-1\nstatus: ready\n---\n\n# Seed slice\n\nSeeded directly in the central thinking space dir.\n`,
);

// A SECOND Thinking Space under a different container ("Apps") — proves two
// spaces are discovered together from the one thinking space root (AC #3), and that the
// container is host-agnostic (Apps would be a Gitea repo in thinkube).
const appsFolder = path.join(tmp, "apps");
const repo2 = path.join(appsFolder, "bar");
const specDir2 = path.join(thinkingSpaceRoot, "Apps", "bar", "specs", "SP-1");
mkdirSync(path.join(repo2, ".git"), { recursive: true });
mkdirSync(specDir2, { recursive: true });
writeFileSync(
  path.join(specDir2, "spec.md"),
  `# Bar spec\n\n## Acceptance Criteria\n\n- [ ] x\n\n## Constraints\n\n- none\n\n## Design\n\n- n/a\n\n## File Structure Plan\n\n- n/a\n`,
);
writeFileSync(
  path.join(specDir2, "SL-1.md"),
  `---\nuid: bar-seed\nparent: SP-1\nstatus: ready\n---\n\n# Bar seed\n\nSeeded in the Apps/bar central thinking space.\n`,
);

// A THIRD space that is a REAL git repo with a commit — proves move→Done writes
// status to the central thinking space while stamping provenance from the CODE repo, and
// leaves the code repo's working tree clean (the git-vs-thinking space split, SL-2).
const bazRepo = path.join(wsFolder, "extensions", "baz");
const bazSpecDir = path.join(
  thinkingSpaceRoot,
  "Platform",
  "extensions",
  "baz",
  "specs",
  "SP-2",
);
mkdirSync(bazRepo, { recursive: true });
const git = (...a) =>
  execFileSync("git", ["-C", bazRepo, ...a], { stdio: "ignore" });
execFileSync("git", ["init", "-q", bazRepo], { stdio: "ignore" });
git("config", "user.email", "harness@thinkube");
git("config", "user.name", "harness");
writeFileSync(path.join(bazRepo, "README.md"), "baz\n");
git("add", ".");
git("commit", "-qm", "init");
const bazHead = execFileSync("git", ["-C", bazRepo, "rev-parse", "HEAD"])
  .toString()
  .trim();
mkdirSync(bazSpecDir, { recursive: true });
writeFileSync(
  path.join(bazSpecDir, "spec.md"),
  `# Baz spec\n\n## Acceptance Criteria\n\n- [x] delivered\n\n## Constraints\n\n- none\n\n## Design\n\n- n/a\n\n## File Structure Plan\n\n- n/a\n`,
);
writeFileSync(
  path.join(bazSpecDir, "SL-1.md"),
  `---\nuid: baz-sl1\nparent: SP-2\nstatus: ready\nsatisfies:\n  - 1\n---\n\n# Baz slice\n\nMoved to Done to exercise provenance.\n`,
);

const child = spawn(process.execPath, [SERVER], {
  cwd: repo, // session cwd = the code repo → default thinking space resolves to it
  env: {
    ...process.env,
    THINKUBE_ALLOW_AI_WRITES: "true",
    THINKUBE_ROOTS: [wsFolder, appsFolder].join(path.delimiter),
    THINKUBE_FOLDERS: JSON.stringify([
      { name: "Platform", path: wsFolder },
      { name: "Apps", path: appsFolder },
    ]),
    THINKUBE_THINKING_SPACE_ROOT: thinkingSpaceRoot,
  },
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );
    setTimeout(
      () => reject(new Error(`timeout waiting for ${method}`)),
      10_000,
    );
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}
async function callTool(name, args) {
  const res = await rpc("tools/call", { name, arguments: args });
  const result = res.result ?? {};
  const text = (result.content?.[0]?.text ?? "").toString();
  return { isError: !!result.isError, text };
}

const checks = [];
const record = (label, pass, detail) => {
  checks.push({ label, pass });
  console.log(`${pass ? "  ✅" : "  ❌"} ${label}`);
  if (detail) console.log(`        ${detail.replace(/\n/g, "\n        ")}`);
};

try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "central-thinking-space-harness", version: "0" },
  });
  notify("notifications/initialized", {});

  console.log("\nstdio harness — SP-8_SL-1 central-root thinking space\n");

  // 1. list_thinking_space (default = the cwd repo) reads the slice seeded in the
  //    central namespace dir — proving discovery + read come from the root.
  const lb = await callTool("list_thinking_space", {});
  let ready = [];
  try {
    ready =
      (JSON.parse(lb.text).columns ?? [])
        .find((c) => c.id === "column-ready")
        ?.cards.map((c) => c.id) ?? [];
  } catch {
    /* leave empty → fails below */
  }
  record(
    "list_thinking_space reads the seeded slice from <thinking-space-root>/Platform/extensions/foo",
    !lb.isError && ready.includes("SP-1_SL-1"),
    `ready=[${ready.join(", ")}]`,
  );

  // 2. create_slice writes under the central namespace; the code repo stays
  //    clean (no .thinkube/ ever appears in it).
  const cs = await callTool("create_slice", {
    spec: 1,
    title: "Written to the central namespace",
    body: "Should land under the thinking space root, not the code repo.",
  });
  const handle = cs.isError ? "" : JSON.parse(cs.text).slice;
  const wroteCentral = existsSync(path.join(specDir, "SL-2.md"));
  const repoClean = !existsSync(path.join(repo, ".thinkube"));
  record(
    "create_slice writes to the central namespace (SL-2.md under thinking space root)",
    !cs.isError && handle === "SP-1_SL-2" && wroteCentral,
    `handle=${handle} wroteCentral=${wroteCentral}`,
  );
  record(
    "the code repo stays clean — no .thinkube/ written into it (AC #2)",
    repoClean,
    `repo=${repo}`,
  );

  // 4. both Thinking Spaces are discovered from the single thinking space root (AC #3).
  const lbs = await callTool("list_thinking_spaces", {});
  const bothFound =
    !lbs.isError &&
    lbs.text.includes(path.resolve(repo)) &&
    lbs.text.includes(path.resolve(repo2));
  record(
    "list_thinking_spaces finds both spaces (Platform/extensions/foo + Apps/bar) from one root (AC #3)",
    bothFound,
    lbs.text.replace(/\s+/g, " ").slice(0, 200),
  );

  // 5. move→Done under central: status writes to the central thinking space, provenance
  //    is stamped from the CODE repo, and the code repo's tree stays clean.
  const mv = await callTool("move_slice", {
    slice: "SP-2_SL-1",
    status: "Done",
    thinkingSpace: bazRepo,
  });
  const bazSl = path.join(bazSpecDir, "SL-1.md");
  const slText = existsSync(bazSl) ? readFileSync(bazSl, "utf8") : "";
  record(
    "move→Done writes status to central + stamps provenance from the CODE repo",
    !mv.isError &&
      /status:\s*done/.test(slText) &&
      slText.includes(`commit: ${bazHead}`),
    `done=${/status:\s*done/.test(slText)} commitFromCodeRepo=${slText.includes(bazHead)} head=${bazHead.slice(0, 8)}`,
  );
  const bazStatus = execFileSync("git", [
    "-C",
    bazRepo,
    "status",
    "--porcelain",
  ])
    .toString()
    .trim();
  record(
    "the code repo working tree stays clean after move→Done (no .thinkube)",
    bazStatus === "",
    `git status: ${bazStatus || "(clean)"}`,
  );

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n${passed}/${checks.length} behaviours held\n`);
  child.kill();
  rmSync(tmp, { recursive: true, force: true });
  process.exit(passed === checks.length ? 0 : 1);
} catch (err) {
  console.error(`harness error: ${err.message}`);
  child.kill();
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
