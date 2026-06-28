#!/usr/bin/env node
/**
 * Harness for SP-8_SL-3 — migrating a co-located thinking space into the sidecar.
 *
 * Proves, end-to-end:
 *   1. migrateThinkingSpaceDir moves EVERY file (no loss) and removes the source
 *      `.thinkube/` (no stub)
 *   2. it REFUSES to overwrite a non-empty target
 *   3. the migrated thinking space is then read from its central namespace by the real
 *      server — the Thinking Space still works (AC #5)
 *
 * Build first: `npm run compile`. Run: `node scripts/migration-harness.mjs`.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const require = createRequire(import.meta.url);
const { migrateThinkingSpaceDir } = require(
  path.join(REPO, "dist", "store", "thinkingSpaceMigration.js"),
);
const SERVER = path.join(REPO, "dist", "mcp", "kanbanMcpServer.js");

function countFiles(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

const tmp = mkdtempSync(path.join(tmpdir(), "migrate-thinking space-"));
const wsFolder = path.join(tmp, "ws");
const repo = path.join(wsFolder, "extensions", "foo");
const coLocated = path.join(repo, ".thinkube");
const thinkingSpaceRoot = path.join(tmp, "thinking space");
const central = path.join(thinkingSpaceRoot, "Platform", "extensions", "foo");

// Seed a co-located thinking space: specs + decisions + retros + the bundle stamp.
mkdirSync(path.join(repo, ".git"), { recursive: true });
mkdirSync(path.join(coLocated, "specs", "SP-1"), { recursive: true });
mkdirSync(path.join(coLocated, "decisions"), { recursive: true });
mkdirSync(path.join(coLocated, "retros"), { recursive: true });
writeFileSync(
  path.join(coLocated, "specs", "SP-1", "spec.md"),
  `# Foo\n\n## Acceptance Criteria\n\n- [ ] x\n\n## Constraints\n\n- none\n\n## Design\n\n- n/a\n\n## File Structure Plan\n\n- n/a\n`,
);
writeFileSync(
  path.join(coLocated, "specs", "SP-1", "SL-1.md"),
  `---\nuid: pre\nparent: SP-1\nstatus: ready\n---\n\n# Pre-migration slice\n\nLived co-located before migration.\n`,
);
writeFileSync(path.join(coLocated, "decisions", "ADR-0001.md"), "# adr\n");
writeFileSync(path.join(coLocated, "retros", "2026-06-05.md"), "# retro\n");
writeFileSync(path.join(coLocated, ".bundle-version.json"), "{}\n");
const before = countFiles(coLocated);

const checks = [];
const record = (label, pass, detail) => {
  checks.push({ label, pass });
  console.log(`${pass ? "  ✅" : "  ❌"} ${label}`);
  if (detail) console.log(`        ${detail}`);
};

console.log("\nharness — SP-8_SL-3 thinking space migration\n");

// ── Part A: the move (no loss, no stub) ──
try {
  const res = await migrateThinkingSpaceDir(coLocated, central);
  const after = existsSync(central) ? countFiles(central) : -1;
  const specThere = existsSync(path.join(central, "specs", "SP-1", "spec.md"));
  record(
    "migrateThinkingSpaceDir moves every file (no loss) and reports the count",
    res.files === before && after === before && specThere,
    `before=${before} after=${after} reported=${res.files}`,
  );
  record(
    "the source .thinkube/ is fully removed — no stub",
    !existsSync(coLocated),
    `coLocated exists=${existsSync(coLocated)}`,
  );
} catch (err) {
  record("migrateThinkingSpaceDir ran without error", false, err.message);
  record("the source .thinkube/ is fully removed — no stub", false);
}

// ── refuse-on-non-empty-target guard ──
mkdirSync(path.join(tmp, "occupied"), { recursive: true });
writeFileSync(path.join(tmp, "occupied", "f"), "x");
let refused = false;
try {
  await migrateThinkingSpaceDir(path.join(tmp, "occupied"), central);
} catch {
  refused = true;
}
record("refuses to overwrite a non-empty target", refused);

// ── Part B: the migrated thinking space reads back from the central root (AC #5) ──
const child = spawn(process.execPath, [SERVER], {
  cwd: repo,
  env: {
    ...process.env,
    THINKUBE_ALLOW_AI_WRITES: "true",
    THINKUBE_ROOTS: wsFolder,
    THINKUBE_FOLDERS: JSON.stringify([{ name: "Platform", path: wsFolder }]),
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
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );
    setTimeout(() => reject(new Error(`timeout ${method}`)), 10_000);
  });

try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "migration-harness", version: "0" },
  });
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
      "\n",
  );
  const res = await rpc("tools/call", {
    name: "list_thinking_space",
    arguments: {},
  });
  const text = res.result?.content?.[0]?.text ?? "";
  let ready = [];
  try {
    ready =
      (JSON.parse(text).columns ?? [])
        .find((c) => c.id === "column-ready")
        ?.cards.map((c) => c.id) ?? [];
  } catch {
    /* leave empty */
  }
  record(
    "the migrated thinking space reads back from the central root (AC #5)",
    ready.includes("SP-1_SL-1"),
    `ready=[${ready.join(", ")}]`,
  );
} catch (err) {
  record("server read of the migrated thinking space", false, err.message);
}

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} behaviours held\n`);
child.kill();
rmSync(tmp, { recursive: true, force: true });
process.exit(passed === checks.length ? 0 : 1);
