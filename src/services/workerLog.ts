import * as vscode from "vscode";

/**
 * Whether AI worker session streams should land in the Output panel
 * (`thinkube.workers.logToOutput`, default true during the field-testing
 * phase; turn off to keep the panel quiet). Read live on every line so
 * toggling the setting takes effect without a reload.
 */
export function workerLogEnabled(): boolean {
  return (
    vscode.workspace
      .getConfiguration("thinkube.workers")
      .get<boolean>("logToOutput") ?? true
  );
}
