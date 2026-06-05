#!/usr/bin/env node
/**
 * Harness for SP-8_SL-4 — graceful "board repo not available".
 *
 * Boots the real server with `thinkube.boards.root` pointing at a MISSING path
 * and asserts a tool call fails with a CLEAR error (not silent emptiness).
 *
 * Build first: `npm run compile`. Run: `node scripts/board-unavailable-harness.mjs`.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(tmpdir(), "board-unavail-"));
const wsFolder = path.join(tmp, "ws");
const repo = path.join(wsFolder, "extensions", "foo");
mkdirSync(path.join(repo, ".git"), { recursive: true });

const child = spawn(process.execPath, [SERVER], {
  cwd: repo,
  env: {
    ...process.env,
    THINKUBE_ALLOW_AI_WRITES: "true",
    THINKUBE_ROOTS: wsFolder,
    THINKUBE_FOLDERS: JSON.stringify([{ name: "Platform", path: wsFolder }]),
    THINKUBE_BOARD_ROOT: path.join(tmp, "does-not-exist"), // configured, absent
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
let id = 1;
const rpc = (method, params) =>
  new Promise((res, rej) => {
    const i = id++;
    pending.set(i, res);
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n",
    );
    setTimeout(() => rej(new Error("timeout " + method)), 10_000);
  });

let pass = false;
let detail = "";
try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "unavail", version: "0" },
  });
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
      "\n",
  );
  const r = await rpc("tools/call", { name: "list_board", arguments: {} });
  const result = r.result ?? {};
  const text = (result.content?.[0]?.text ?? "").toString();
  pass = !!result.isError && /not available/i.test(text);
  detail = text.replace(/\s+/g, " ").slice(0, 160);
} catch (e) {
  detail = e.message;
}

console.log("\nharness — SP-8_SL-4 board-root-unavailable\n");
console.log(
  `${pass ? "  ✅" : "  ❌"} a tool call fails CLEARLY when the board root is missing (not silent)`,
);
console.log(`        ${detail}`);
child.kill();
rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
