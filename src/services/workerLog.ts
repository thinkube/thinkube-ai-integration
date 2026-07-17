import * as vscode from "vscode";

/**
 * Whether AI worker session streams should land in the Output panel
 * (`thinkube.workers.logToOutput`, default false — worker chatter is gold for
 * testing but must not occupy the panel by default). Read live on every line
 * so toggling the setting takes effect without a reload.
 */
export function workerLogEnabled(): boolean {
  return (
    vscode.workspace
      .getConfiguration("thinkube.workers")
      .get<boolean>("logToOutput") ?? false
  );
}
