/**
 * Thinky diagnostics channel (2026-07-17 field debugging): unconditional,
 * lightweight lines into the "Thinkube Scratchpad" output AND a plain file
 * (~/.thinky-diag.log) so field sessions can be diagnosed without the human
 * hunting panels — the assistant reads the file directly.
 */
import { appendLogFile, scratchpadChannel } from "../output";
export function thinkyDiag(line: string): void {
  const stamped = `${new Date().toISOString()} [thinky] ${line}`;
  appendLogFile(stamped);
  scratchpadChannel()?.appendLine(stamped);
}
