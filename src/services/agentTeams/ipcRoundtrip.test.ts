/**
 * IPC-roundtrip integration test (SP-tgnb5o_SL-3, AC#4 mechanism).
 *
 * Exercises the real on-PATH shim CLI (wrapper/tmux-shim.js) end-to-end: it
 * connects over a unix socket to the shared `createTmuxShimServer` framing and
 * a `TmuxRegistry` backed by a recording fake pane. This proves the full wire
 * path — argv → socket → dispatch → response → CLI exit — and, crucially for
 * AC#4, that `send-keys` input is routed to the *correct* teammate's PTY. The
 * live VS Code pane rendering is the recorded acceptance-gate exception.
 *
 * Run via `npm test`. Uses async execFile so the in-process server's event
 * loop keeps serving while the child CLI runs (a sync child would deadlock).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { TmuxRegistry, type Pane, type PaneFactory } from "./tmuxDispatcher";
import { createTmuxShimServer } from "./ipcServer";

const pexec = promisify(execFile);

// wrapper/tmux-shim.js lives at the repo root; the compiled test runs from
// out-test/services/agentTeams, so walk back up three levels.
const SHIM_CLI = path.resolve(__dirname, "../../..", "wrapper", "tmux-shim.js");

interface RecordingPane extends Pane {
  writes: string[];
}

class RecordingFactory implements PaneFactory {
  panes = new Map<string, RecordingPane>();
  spawn(spec: { paneId: string }): Pane {
    const pane: RecordingPane = {
      id: spec.paneId,
      writes: [],
      write(d) {
        this.writes.push(d);
      },
      kill() {},
    };
    this.panes.set(spec.paneId, pane);
    return pane;
  }
}

test("shim CLI round-trips through the socket and routes send-keys to the right pane", async () => {
  const factory = new RecordingFactory();
  const registry = new TmuxRegistry(factory, () => {});
  const server = createTmuxShimServer(registry);

  const sock = path.join(os.tmpdir(), `tmux-shim-it-${process.pid}.sock`);
  fs.rmSync(sock, { force: true });
  await new Promise<void>((resolve) => server.listen(sock, resolve));

  const env = { ...process.env, THINKUBE_TMUX_SHIM_SOCK: sock };
  const run = async (args: string[]) => {
    try {
      const { stdout } = await pexec("node", [SHIM_CLI, ...args], { env });
      return { stdout, code: 0 };
    } catch (e) {
      const err = e as { stdout?: string; code?: number };
      return { stdout: err.stdout ?? "", code: err.code ?? 0 };
    }
  };

  try {
    // Two teammates in one session, like an agent team forming.
    const p0 = (
      await run([
        "new-session",
        "-d",
        "-s",
        "team",
        "-P",
        "-F",
        "#{pane_id}",
        "--",
        "node",
        "-e",
        "",
      ])
    ).stdout.trim();
    const p1 = (
      await run([
        "split-window",
        "-t",
        "team",
        "-P",
        "-F",
        "#{pane_id}",
        "--",
        "node",
        "-e",
        "",
      ])
    ).stdout.trim();
    assert.equal(p0, "%0");
    assert.equal(p1, "%1");

    // Route literal input + Enter to teammate 1 specifically (AC#4).
    await run(["send-keys", "-t", `team:0.${p1}`, "-l", "--", "hello %1"]);
    await run(["send-keys", "-t", p1, "Enter"]);
    // And something to teammate 0, to prove they don't cross.
    await run(["send-keys", "-t", p0, "-l", "--", "for %0"]);

    assert.deepEqual(factory.panes.get("%1")!.writes, ["hello %1", "\r"]);
    assert.deepEqual(factory.panes.get("%0")!.writes, ["for %0"]);

    // has-session reflects the live team through the CLI.
    assert.equal((await run(["has-session", "-t", "team"])).code, 0);
    assert.equal((await run(["has-session", "-t", "ghost"])).code, 1);

    // client_control_mode stays empty over the wire (AC#3, end-to-end).
    assert.equal(
      (await run(["display-message", "-p", "#{client_control_mode}"])).stdout,
      "",
    );
  } finally {
    server.close();
    fs.rmSync(sock, { force: true });
  }
});
