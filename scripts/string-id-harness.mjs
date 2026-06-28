#!/usr/bin/env node
/**
 * Harness for SP-7_SL-1 — the thinking space handles opaque string Spec ids.
 *
 * Boots the real server against a thinking space holding BOTH a base36-style string-id
 * Spec (`SP-tw7n0g`) and a legacy integer Spec (`SP-1`), and proves the server
 * reads, addresses, moves, and creates against string ids while the integer
 * Spec still works (AC #4, #5, #6).
 *
 * Build first: `npm run compile`. Run: `node scripts/string-id-harness.mjs`.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(
  path.resolve(HERE, ".."),
  "dist",
  "mcp",
  "kanbanMcpServer.js",
);

const SPEC = (title) =>
  `# ${title}\n\n## Acceptance Criteria\n\n- [ ] x\n\n## Constraints\n\n- none\n\n## Design\n\n- n/a\n\n## File Structure Plan\n\n- n/a\n`;
const SLICE = (uid, parent) =>
  `---\nuid: ${uid}\nparent: SP-${parent}\nstatus: ready\n---\n\n# ${uid}\n\nSeed slice.\n`;

const thinkingSpace = mkdtempSync(path.join(tmpdir(), "string-id-"));
for (const [id, uid] of [
  ["tw7n0g", "string-seed"],
  ["1", "legacy-seed"],
]) {
  const d = path.join(thinkingSpace, ".thinkube", "specs", `SP-${id}`);
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, "spec.md"), SPEC(`Spec ${id}`));
  writeFileSync(path.join(d, "SL-1.md"), SLICE(uid, id));
}

const child = spawn(process.execPath, [SERVER], {
  cwd: thinkingSpace,
  env: {
    ...process.env,
    THINKUBE_ALLOW_AI_WRITES: "true",
    THINKUBE_ROOTS: thinkingSpace,
  },
  stdio: ["pipe", "pipe", "inherit"],
});
let buf = "";
const pending = new Map();
child.stdout.on("data", (c) => {
  buf += c.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.id !== undefined && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  }
});
let nextId = 1;
const rpc = (method, params) =>
  new Promise((res, rej) => {
    const i = nextId++;
    pending.set(i, res);
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n",
    );
    setTimeout(() => rej(new Error("timeout " + method)), 10_000);
  });
const callTool = async (name, args) => {
  const r = await rpc("tools/call", { name, arguments: args });
  const res = r.result ?? {};
  return {
    isError: !!res.isError,
    text: (res.content?.[0]?.text ?? "").toString(),
  };
};

const checks = [];
const record = (label, pass, detail) => {
  checks.push({ label, pass });
  console.log(`${pass ? "  ✅" : "  ❌"} ${label}`);
  if (detail) console.log(`        ${detail}`);
};

try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "string-id", version: "0" },
  });
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
      "\n",
  );

  console.log("\nharness — SP-7_SL-1 string Spec ids\n");

  const lb = await callTool("list_thinking_space", {});
  let ready = [];
  try {
    ready =
      (JSON.parse(lb.text).columns ?? [])
        .find((c) => c.id === "column-ready")
        ?.cards.map((c) => c.id) ?? [];
  } catch {
    /* empty */
  }
  record(
    "list_thinking_space reads BOTH a string-id Spec and a legacy integer Spec",
    ready.includes("SP-tw7n0g_SL-1") && ready.includes("SP-1_SL-1"),
    `ready=[${ready.join(", ")}]`,
  );

  const mv = await callTool("move_slice", {
    slice: "SP-tw7n0g_SL-1",
    status: "Doing",
  });
  record(
    "move_slice addresses a string-id slice (→ Doing)",
    !mv.isError && /"status":\s*"doing"/.test(mv.text),
    mv.text.replace(/\s+/g, " ").slice(0, 120),
  );

  const cs = await callTool("create_slice", {
    spec: "tw7n0g",
    title: "second slice under a string-id spec",
    body: "Created with a string spec id.",
  });
  const handle = cs.isError ? "" : JSON.parse(cs.text).slice;
  record(
    "create_slice mints SL-2 under the string-id Spec (slices stay SL-1..n)",
    !cs.isError && handle === "SP-tw7n0g_SL-2",
    `handle=${handle}`,
  );

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n${passed}/${checks.length} behaviours held\n`);
  child.kill();
  rmSync(thinkingSpace, { recursive: true, force: true });
  process.exit(passed === checks.length ? 0 : 1);
} catch (err) {
  console.error(`harness error: ${err.message}`);
  child.kill();
  rmSync(thinkingSpace, { recursive: true, force: true });
  process.exit(2);
}
