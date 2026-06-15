/**
 * AgentTeamsShimServer — the Extension-Host half of the fake-`tmux` backend
 * for Claude Code agent teams (SP-tgnb5o_SL-1, spike).
 *
 * Each `tmux …` invocation Claude Code makes is a short-lived process, but the
 * pane/PTY state must outlive it and live where the VS Code terminals are — in
 * the Extension Host. So this service runs a tiny IPC server on a unix socket
 * (named pipe on Windows); the on-PATH `tmux` shim (wrapper/tmux-shim.js)
 * connects, sends its argv as one JSON line, and gets back `{stdout, exitCode}`.
 * The socket path is published to child processes via THINKUBE_TMUX_SHIM_SOCK,
 * exactly as the cwd-wrapper publishes CLAUDE_CWD_PROXY_DIR (see LauncherService).
 *
 * The command surface itself lives in the pure `TmuxRegistry` (tmuxDispatcher.ts,
 * unit-tested headlessly). This file supplies the real `PaneFactory`: a node-pty
 * teammate process rendered through a VS Code `Pseudoterminal`. node-pty is a
 * native module loaded lazily so a missing/unbuilt binary degrades to a logged
 * no-op pane rather than breaking activation.
 *
 * Interactive behaviour (a real team forming, both teammates reaching idle —
 * AC#1) is verified at the acceptance gate per the Spec's recorded TEP-tgnvkw
 * exception; what's gated headlessly is the dispatcher + this wiring compiling.
 */
import * as vscode from "vscode";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  TmuxRegistry,
  type Pane,
  type PaneFactory,
  type TeammateSpec,
} from "./tmuxDispatcher";

export const SHIM_SOCK_ENV = "THINKUBE_TMUX_SHIM_SOCK";

// Minimal shape of the bits of node-pty we use — declared locally so `tsc`
// needs no compile-time dependency on the native module (it's require()'d lazily).
interface PtyProcess {
  write(data: string): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  kill(): void;
}
interface NodePty {
  spawn(
    file: string,
    args: string[],
    opts: {
      name: string;
      cols: number;
      rows: number;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    },
  ): PtyProcess;
}

export class AgentTeamsShimServer implements vscode.Disposable {
  private server: net.Server | undefined;
  private socketPath: string | undefined;
  private nodePty: NodePty | null | undefined; // undefined=untried, null=unavailable

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  /** Start the IPC server and publish its socket path to child processes. */
  async activate(): Promise<void> {
    const stateDir = this.context.globalStorageUri.fsPath;
    await fs.promises.mkdir(stateDir, { recursive: true });
    this.socketPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\thinkube-tmux-shim`
        : path.join(stateDir, "tmux-shim.sock");

    // Clear a stale socket file from a previous host (POSIX only).
    if (process.platform !== "win32") {
      await fs.promises.rm(this.socketPath, { force: true }).catch(() => {});
    }

    const registry = new TmuxRegistry(this.makeFactory(), (m) =>
      this.output.appendLine(`[tmux-shim] ${m}`),
    );

    this.server = net.createServer((conn) => {
      let buf = "";
      conn.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const nl = buf.indexOf("\n");
        if (nl === -1) return; // wait for the full request line
        const line = buf.slice(0, nl);
        let argv: string[] = [];
        try {
          const req = JSON.parse(line) as { argv?: unknown };
          if (Array.isArray(req.argv)) argv = req.argv.map(String);
        } catch {
          this.output.appendLine(`[tmux-shim] bad request: ${line}`);
        }
        let res: { stdout: string; exitCode: number };
        try {
          res = registry.dispatch(argv);
        } catch (err) {
          // A handler fault must not take down Claude's display — log-and-no-op.
          this.output.appendLine(
            `[tmux-shim] dispatch error for ${argv.join(" ")}: ${(err as Error).message}`,
          );
          res = { stdout: "", exitCode: 0 };
        }
        conn.end(JSON.stringify(res) + "\n");
      });
      conn.on("error", () => {
        /* client went away mid-request; nothing to clean up */
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.socketPath!, () => {
        this.server!.removeListener("error", reject);
        resolve();
      });
    });

    process.env[SHIM_SOCK_ENV] = this.socketPath;
    this.output.appendLine(
      `[tmux-shim] listening on ${this.socketPath} (${SHIM_SOCK_ENV})`,
    );
  }

  /** Socket path child processes connect to (for the shim CLI / tests). */
  get socket(): string | undefined {
    return this.socketPath;
  }

  /** Build the real PaneFactory: node-pty teammate → VS Code terminal pane. */
  private makeFactory(): PaneFactory {
    return {
      spawn: (spec: TeammateSpec): Pane => this.spawnPane(spec),
    };
  }

  private loadNodePty(): NodePty | null {
    if (this.nodePty !== undefined) return this.nodePty;
    try {
      // Lazy native require — only needed when a team actually forms.
      this.nodePty = require("node-pty") as NodePty;
    } catch (err) {
      this.output.appendLine(
        `[tmux-shim] node-pty unavailable (${(err as Error).message}); ` +
          `panes will be inert until it's installed/rebuilt for this runtime.`,
      );
      this.nodePty = null;
    }
    return this.nodePty;
  }

  private spawnPane(spec: TeammateSpec): Pane {
    const pty = this.loadNodePty();
    if (!pty) {
      // Degraded: no PTY backend. Return an inert pane so the dispatcher and
      // Claude keep working; the drift/conformance test (SL-4) and the
      // interactive acceptance check surface the real-world gap.
      return { id: spec.paneId, write: () => {}, kill: () => {} };
    }

    const proc = pty.spawn(spec.command, spec.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: spec.cwd,
      env: { ...process.env, ...(spec.env ?? {}) },
    });

    // Render the teammate's PTY bytes straight through a VS Code terminal pane
    // (no scrollback/vt buffer — out of scope per the Spec). handleInput routes
    // the user's keystrokes back to this teammate (AC#4 groundwork).
    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<number | void>();
    const term = vscode.window.createTerminal({
      name: `team:${spec.sessionName} ${spec.paneId}`,
      pty: {
        onDidWrite: writeEmitter.event,
        onDidClose: closeEmitter.event,
        open: () => {},
        close: () => proc.kill(),
        handleInput: (data: string) => proc.write(data),
      },
    });
    proc.onData((d) => writeEmitter.fire(d));
    proc.onExit(({ exitCode }) => closeEmitter.fire(exitCode));
    term.show(/* preserveFocus */ true);

    return {
      id: spec.paneId,
      write: (data: string) => proc.write(data),
      kill: () => {
        proc.kill();
        term.dispose();
      },
    };
  }

  dispose(): void {
    this.server?.close();
    if (this.socketPath && process.platform !== "win32") {
      fs.rm(this.socketPath, { force: true }, () => {});
    }
    if (process.env[SHIM_SOCK_ENV] === this.socketPath) {
      delete process.env[SHIM_SOCK_ENV];
    }
  }
}
