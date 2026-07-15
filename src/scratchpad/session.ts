// src/scratchpad/session.ts — the held Scratchpad session (TEP-21/SP-3).
import * as vscode from "vscode";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";

import { emptyModel, reduce } from "./model";
import type { Action, Delta, SectionKind, WorkingModel } from "./model";
import { deserialize, serialize } from "./persistence";
import { gapFiller } from "./workers/worker";
import type { QueryFn } from "./workers/worker";
import { createLoop } from "./loop";
import { buildScratchpadHtml, ScratchpadDocumentView } from "./views/document";
import type { ScratchpadInboundMessage } from "./views/document";

// Re-export so callers can import the message type from session / index.
export type { ScratchpadInboundMessage } from "./views/document";

// ===== Shared types (SP-21/3 contract) =====

/**
 * Result of a non-committing dry-run slice — imported by consumers and
 * injected through ScratchpadSessionDeps.runSlicer.
 */
export interface DryRunResult {
  cleanCut: boolean;
  gapSection: SectionKind | null;
  decomposition?: string[];
}

/**
 * Signs the frozen body and writes the resulting TEP artifact.
 * (SP-21/3 contract — includes stamp() which freeze.ts will add in SL-4.)
 */
export interface SigningTool {
  /** Appends a provenance stamp line to body and returns the result. */
  stamp(body: string): string;
  writeTep(args: {
    thinking_space: string;
    title: string;
    status: string;
    body: string;
  }): Promise<{ tep: string }>;
}

/**
 * Persistent store for research dossiers.
 * Default is rooted at <sidecarRoot>/<namespace>/research/ (SL-3 wires it).
 */
export interface DossierStore {
  read(topic: string): Promise<string | undefined>;
  write(topic: string, markdown: string): Promise<{ dossierRef: string }>;
}

// ===== Public types =====

export interface ScratchpadSessionDeps {
  /**
   * Named document to open (default: "default").
   * Stored at <sidecarRoot>/<namespace>/thinking/<space>.json.
   */
  space?: string;
  /**
   * Repository/project namespace directory under sidecarRoot (default: "default").
   */
  namespace?: string;
  /**
   * Root directory for sidecar files (default: the
   * `thinkube.thinkingSpace.root` setting; when that resolves empty the
   * session runs IN-MEMORY: no file is written and flush() is a no-op).
   */
  sidecarRoot?: string;
  /**
   * Injectable worker query factory (a test injects a fake QueryFn).
   */
  loadQuery?: () => QueryFn;
  /**
   * Non-committing dry-run slicer (wired by SL-4).
   */
  runSlicer?: (intent: string) => Promise<DryRunResult>;
  /**
   * Signing tool for freeze (wired by SL-4).
   */
  signing?: SigningTool;
  /**
   * Research dossier store (wired by SL-3).
   */
  dossier?: DossierStore;
  /**
   * Clock for evidence timestamps (default: () => new Date()).
   */
  now?: () => Date;
  /**
   * Model id passed to workers (default: the
   * `thinkube.orchestrator.workerModel` setting, else "sonnet").
   */
  workerModel?: string;
}

export interface ScratchpadSession {
  /** The live working model — mutated ONLY via dispatch (the one reducer path). */
  readonly model: WorkingModel;
  /**
   * Every action's Delta (applied or rejected), in application order.
   */
  readonly deltas: Delta[];
  /**
   * Apply one action through the pure reducer; appends to deltas, fires
   * onDidChange, updates the open panel, debounce-persists to disk.
   * Returns the applied or rejected Delta.
   */
  dispatch(action: Action): Delta;
  /** Fires after every dispatch with the new model. */
  onDidChange(listener: (model: WorkingModel) => void): { dispose(): void };
  /**
   * The panel's full current HTML (the exact string the webview is given).
   */
  renderedHtml(): string;
  /**
   * Run the GAP-FILLING worker — always gapFiller regardless of model.phase.
   * Every action it yields lands through dispatch.
   * Resolves when the worker's actions are applied.
   */
  askForStructure(): Promise<void>;
  /**
   * Flush pending debounced persistence to disk NOW.
   */
  flush(): Promise<void>;
  /**
   * The panel's REAL inbound path, exposed as a seam.
   * Every inbound webview message routes here and dispatches with actor:"human".
   * Returns after the message is fully applied.
   */
  postFromWebview(message: ScratchpadInboundMessage): Promise<void>;
}

// ===== Module-level state =====

let _session: ScratchpadSessionImpl | undefined;

/**
 * Extension URI needed to create webview panels.
 */
let _extensionUri: vscode.Uri | undefined;

/**
 * Called from registerScratchpadCommands (index.ts) to provide the extension
 * URI for panel creation.
 */
export function _bootstrapExtensionUri(uri: vscode.Uri): void {
  _extensionUri = uri;
}

// ===== Session implementation =====

class ScratchpadSessionImpl implements ScratchpadSession {
  private _model: WorkingModel;
  private _deltas: Delta[] = [];
  private readonly _listeners = new Set<(model: WorkingModel) => void>();
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly _sidecarRoot: string | undefined;
  private readonly _namespace: string;
  private readonly _space: string;
  private readonly _loadQueryFn: () => QueryFn;
  private readonly _workerModelId: string;
  private _view: ScratchpadDocumentView | undefined;

  constructor(
    model: WorkingModel,
    sidecarRoot: string | undefined,
    namespace: string,
    space: string,
    workerModelId: string,
    loadQueryFn: () => QueryFn,
  ) {
    this._model = model;
    this._sidecarRoot = sidecarRoot;
    this._namespace = namespace;
    this._space = space;
    this._workerModelId = workerModelId;
    this._loadQueryFn = loadQueryFn;
  }

  get model(): WorkingModel {
    return this._model;
  }

  get deltas(): Delta[] {
    return this._deltas;
  }

  dispatch(action: Action): Delta {
    const { model, delta } = reduce(this._model, action);
    this._model = model;
    this._deltas.push(delta);
    // Notify listeners
    for (const listener of this._listeners) {
      listener(this._model);
    }
    // Push updated model into the open panel
    if (this._view) {
      this._view.update(this._model);
    }
    // Debounce-persist to disk
    this._scheduleFlush();
    return delta;
  }

  onDidChange(listener: (model: WorkingModel) => void): { dispose(): void } {
    this._listeners.add(listener);
    return {
      dispose: () => {
        this._listeners.delete(listener);
      },
    };
  }

  renderedHtml(): string {
    return buildScratchpadHtml(this._model);
  }

  async askForStructure(): Promise<void> {
    const worker = gapFiller({
      loadQuery: this._loadQueryFn,
      model: this._workerModelId,
    });
    const loop = createLoop({ workerFor: () => worker });
    const actions = await loop.step(this._model, []);
    for (const action of actions) {
      this.dispatch(action);
    }
  }

  async flush(): Promise<void> {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
    }
    await this._persistNow();
  }

  /**
   * The REAL inbound path — the same function the webview channel's
   * onDidReceiveMessage invokes. All messages dispatch with actor:"human".
   */
  async postFromWebview(message: ScratchpadInboundMessage): Promise<void> {
    switch (message.type) {
      // ── Intent (goal) ────────────────────────────────────────────────────
      case "seedGoal":
        this.dispatch({ type: "seedGoal", text: message.text });
        break;
      case "editGoal":
        this.dispatch({ type: "editGoal", text: message.text });
        break;

      // ── Item actions (all actor:"human") ─────────────────────────────────
      case "addItem":
        this.dispatch({
          type: "addItem",
          actor: "human",
          sectionId: message.sectionId,
          text: message.text,
          // attend 2026-07-15 (AC-1): the message MAY carry a modality; dropping it
          // silently stripped 'optional' items to the default.
          ...((message as { modality?: "mandatory" | "optional" }).modality
            ? { modality: (message as { modality?: "mandatory" | "optional" }).modality }
            : {}),
        });
        break;
      case "toggleItem":
        if (message.checked) {
          this.dispatch({
            type: "checkItem",
            actor: "human",
            itemId: message.itemId,
          });
        } else {
          this.dispatch({
            type: "uncheckItem",
            actor: "human",
            itemId: message.itemId,
          });
        }
        break;
      case "editItemText":
        this.dispatch({
          type: "editItemText",
          actor: "human",
          itemId: message.itemId,
          text: message.text,
        });
        break;
      case "setModality":
        this.dispatch({
          type: "setModality",
          actor: "human",
          itemId: message.itemId,
          modality: message.modality,
        });
        break;
      case "setEval":
        this.dispatch({
          type: "setEval",
          actor: "human",
          itemId: message.itemId,
          facet: message.facet,
          value: message.value,
        });
        break;
      case "deferItem":
        this.dispatch({
          type: "deferItem",
          actor: "human",
          itemId: message.itemId,
        });
        break;
      case "dropItem":
        this.dispatch({
          type: "dropItem",
          actor: "human",
          itemId: message.itemId,
        });
        break;
      case "supersedeItem":
        this.dispatch({
          type: "supersedeItem",
          actor: "human",
          itemId: message.itemId,
          supersedes: message.supersedes,
        });
        break;
      case "resolveEdit":
        this.dispatch({
          type: "resolveEdit",
          actor: "human",
          itemId: message.itemId,
          accept: message.accept,
        });
        break;
      case "addItemNote":
        this.dispatch({
          type: "addItemNote",
          actor: "human",
          itemId: message.itemId,
          text: message.text,
        });
        break;

      // ── Worker round triggers (stubs — wired in SL-2/3/4/5) ─────────────
      case "prefill":
        // SL-2 wires this to the real gapFiller worker with production query
        await this.askForStructure();
        break;
      case "reframe":
        // SL-2 wires this to the reframe worker
        break;
      case "research":
        // SL-3 wires this to the research worker
        break;
      case "checkReadiness":
        // SL-4 wires this to runSlicer → recordReadiness
        break;
      case "freeze":
        // SL-4 wires this to the signing pipeline
        break;
      case "command":
        // SL-5 wires this to the interpreter
        break;
    }
  }

  /** Reveal an existing panel or create a new one. */
  revealPanel(): void {
    if (!_extensionUri) {
      return;
    }
    if (!this._view) {
      this._view = new ScratchpadDocumentView();
    }
    this._view.show(_extensionUri, this._model, (msg) =>
      this.postFromWebview(msg),
    );
  }

  private _scheduleFlush(): void {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = undefined;
      void this._persistNow();
    }, 500);
  }

  private async _persistNow(): Promise<void> {
    if (!this._sidecarRoot) return;
    const dir = nodePath.join(this._sidecarRoot, this._namespace, "thinking");
    await nodeFs.mkdir(dir, { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(dir, `${this._space}.json`),
      serialize(this._model),
      "utf8",
    );
  }
}

// ===== Public API =====

/**
 * openScratchpad's promise means "the panel IS open": VS Code's tab model
 * reflects createWebviewPanel asynchronously, so resolving before the tab is
 * observable makes the caller see a shown panel that tabGroups does not list yet.
 */
async function awaitPanelVisible(): Promise<void> {
  if (!_extensionUri) return;
  for (let i = 0; i < 40; i++) {
    const open = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .some((t) => t.label === "Thinkube Scratchpad");
    if (open) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Open (or reveal) the Thinking Space panel bound to the named document.
 *
 * Document path: <sidecarRoot>/<namespace>/thinking/<space>.json
 *
 * Cold-start: if the named document exists it is deserialize()d as the model;
 * else emptyModel("tep") seeds six sections with empty item lists.
 *
 * The command `thinkube.scratchpad.open` calls this with no deps.
 */
export async function openScratchpad(
  deps?: ScratchpadSessionDeps,
): Promise<ScratchpadSession> {
  // Reuse existing session when no deps are provided (panel re-open)
  if (!deps && _session) {
    _session.revealPanel();
    await awaitPanelVisible();
    return _session;
  }

  // Resolve sidecar root
  const sidecarRoot =
    deps?.sidecarRoot ??
    (vscode.workspace
      .getConfiguration("thinkube.thinkingSpace")
      .get<string>("root")
      ?.trim() ||
      undefined);

  const namespace = deps?.namespace ?? "default";
  const space = deps?.space ?? "default";

  // Cold-start: deserialize from named document or start fresh
  let model: WorkingModel = emptyModel("tep");
  if (sidecarRoot) {
    try {
      const text = await nodeFs.readFile(
        nodePath.join(sidecarRoot, namespace, "thinking", `${space}.json`),
        "utf8",
      );
      model = deserialize(text);
    } catch {
      // File not found or unreadable — use the empty model.
    }
  }

  // Resolve worker model id
  const workerModel =
    deps?.workerModel ??
    vscode.workspace
      .getConfiguration("thinkube.orchestrator")
      .get<string>("workerModel") ??
    "sonnet";

  // Resolve loadQuery
  const loadQueryFn: () => QueryFn =
    deps?.loadQuery ??
    ((): QueryFn => (_args) =>
      (async function* () {
        /* yields nothing — production wiring arrives in SL-2 */
      })());

  const session = new ScratchpadSessionImpl(
    model,
    sidecarRoot,
    namespace,
    space,
    workerModel,
    loadQueryFn,
  );
  _session = session;
  session.revealPanel();
  await awaitPanelVisible();
  return session;
}

/**
 * The session the last openScratchpad created (undefined before the first open).
 */
export function getScratchpadSession(): ScratchpadSession | undefined {
  return _session;
}
