/**
 * Thinky diagnostics channel (2026-07-17 field debugging): unconditional,
 * lightweight lines into the "Thinkube Scratchpad" output so field reports
 * can say WHICH path ran instead of guessing.
 */
import type * as vscode from "vscode";
function vs(): typeof vscode {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("vscode") as typeof vscode;
}
let _channel: vscode.OutputChannel | undefined;
export function thinkyDiag(line: string): void {
  try {
    _channel ??= vs().window.createOutputChannel("Thinkube Scratchpad");
    _channel.appendLine(`[thinky] ${line}`);
  } catch {
    /* headless test host */
  }
}
