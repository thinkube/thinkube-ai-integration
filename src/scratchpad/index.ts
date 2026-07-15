import * as vscode from "vscode";
import {
  openScratchpad,
  getScratchpadSession,
  _bootstrapExtensionUri,
} from "./session";

// ===== Public re-exports from model =====

export { emptyModel, goalSection, reduce, freezeEnabled } from "./model";
export type {
  Tenant,
  Phase,
  SectionKind,
  SectionState,
  Coverage,
  ToolName,
  Note,
  Proposal,
  Objection,
  Section,
  ReadinessRecord,
  WorkingModel,
  Action,
  Delta,
  // SP-21/3 new types
  Modality,
  ItemState,
  ItemOrigin,
  Actor,
  Evidence,
  PendingEdit,
  Item,
} from "./model";

export { serialize, deserialize } from "./persistence";

export {
  createPhaseWorker,
  gapFiller,
  integrator,
  GATES,
  assertWithinGate,
} from "./workers/worker";
export type {
  WorkerMessage,
  QueryFn,
  QueryOptions,
  PhaseWorkerDeps,
  WorkerFactoryDeps,
  WorkerRun,
} from "./workers/worker";

export { createLoop, ScratchpadLoop } from "./loop";
export type { PhaseWorkerMap, ScratchpadLoopDeps } from "./loop";

export {
  buildScratchpadHtml,
  ScratchpadDocumentView,
  STATE_MARKERS,
} from "./views/document";

// ===== Session seams =====

export { openScratchpad, getScratchpadSession } from "./session";
export type {
  ScratchpadSessionDeps,
  ScratchpadSession,
  ScratchpadInboundMessage,
  DryRunResult,
  SigningTool,
  DossierStore,
} from "./session";

// ===== Command registration =====

/**
 * Register the Scratchpad commands with VS Code.
 * Call this from extension.ts activate().
 */
export function registerScratchpadCommands(
  context: vscode.ExtensionContext,
): void {
  // Provide the extension URI to session.ts so it can create webview panels.
  _bootstrapExtensionUri(context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.scratchpad.open", async () => {
      await openScratchpad();
    }),
  );
}
