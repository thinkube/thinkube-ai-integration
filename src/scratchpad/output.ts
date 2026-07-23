/**
 * The single "Thinkube Scratchpad" output channel, shared by every writer
 * (worker streams via scratchpadLog, diagnostics via thinkyDiag). Creating the
 * channel more than once yields distinct channels that share a display name —
 * writes then split across them and the human sees only half. One lazily-made
 * instance keeps every line in one place. vscode is required lazily so this
 * module stays import-safe in the headless test host.
 */
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import type * as vscode from "vscode";

/** The single on-disk mirror of the "Thinkube Scratchpad" output — worker
 *  streams AND diagnostics — so a field session is diagnosable from one file
 *  without the human (or the assistant) hunting the Output panel. */
export const SCRATCHPAD_LOG_FILE = nodePath.join(
  nodeOs.homedir(),
  ".thinky-diag.log",
);

/** Append one line to the shared log file (fail-soft on a read-only home). */
export function appendLogFile(line: string): void {
  try {
    nodeFs.appendFileSync(SCRATCHPAD_LOG_FILE, line + "\n");
  } catch {
    /* read-only home — the output channel still gets it */
  }
}

let _channel: vscode.OutputChannel | undefined;

export function scratchpadChannel(): vscode.OutputChannel | undefined {
  try {
    if (!_channel) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const vs = require("vscode") as typeof vscode;
      _channel = vs.window.createOutputChannel("Thinkube Scratchpad");
    }
    return _channel;
  } catch {
    return undefined; // no output channel (test host)
  }
}
