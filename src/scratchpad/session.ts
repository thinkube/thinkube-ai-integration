// src/scratchpad/session.ts — the held Scratchpad session (TEP-21/SP-2).
import * as vscode from "vscode";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";

import { emptyModel, reduce } from "./model";
import type { Action, Delta, WorkingModel } from "./model";
import { deserialize, serialize } from "./persistence";
import { gapFiller } from "./workers/worker";
import type { QueryFn } from "./workers/worker";
import { createLoop } from "./loop";
import { buildScratchpadHtml, ScratchpadDocumentView } from "./views/document";

// ===== Public types =====

export interface ScratchpadSessionDeps {
  /**
   * Injectable worker query factory (a test injects a fake QueryFn — it
   * observes the model id per call via options.model; the product default wires
   * the configured Claude model).
   */
  loadQuery?: () => QueryFn;
  /**
   * Root directory for the session file (default: the
   * `thinkube.thinkingSpace.root` setting; when that resolves empty, the session
   * runs IN-MEMORY: no file is written and flush() is a no-op).
   */
  sidecarRoot?: string;
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
   * Every applied action's Delta (action + field path + before/after values),
   * in application order.
   */
  readonly deltas: Delta[];
  /**
   * Apply one action through SP-1's pure reduce; appends to deltas, fires
   * onDidChange, updates the open panel, debounce-persists serialize(model) to
   * `<sidecarRoot>/scratchpad/current.json`. Returns the applied Delta.
   */
  dispatch(action: Action): Delta;
  /** Fires after every applied action with the new model. */
  onDidChange(listener: (model: WorkingModel) => void): { dispose(): void };
  /**
   * The panel's full current HTML (the exact string the webview is given).
   * Contains: every section's text and state marker; the delta log with each
   * delta's before AND after values; and the Freeze control as a
   * `<button id="freeze">` whose `disabled` ATTRIBUTE is PRESENT when SP-1's
   * freezeEnabled(model) is false and ABSENT when true.
   */
  renderedHtml(): string;
  /**
   * Run the GAP-FILLING worker via SP-1's createLoop with this session's deps —
   * ALWAYS gapFiller, regardless of model.phase; every action it yields lands
   * through dispatch. Resolves when the worker's actions are applied.
   */
  askForStructure(): Promise<void>;
  /**
   * Flush pending debounced persistence to disk NOW (a test calls this before
   * asserting on the session file).
   */
  flush(): Promise<void>;
}

// ===== Module-level state =====

let _session: ScratchpadSessionImpl | undefined;

/**
 * Extension URI needed to create webview panels.
 * Set by _bootstrapExtensionUri() when commands are registered.
 */
let _extensionUri: vscode.Uri | undefined;

/**
 * Called from registerScratchpadCommands (index.ts) to provide the extension
 * URI for panel creation. Must be called before openScratchpad creates panels.
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
  private readonly _loadQueryFn: () => QueryFn;
  private readonly _workerModelId: string;
  private _view: ScratchpadDocumentView | undefined;

  constructor(
    model: WorkingModel,
    sidecarRoot: string | undefined,
    workerModelId: string,
    loadQueryFn: () => QueryFn,
  ) {
    this._model = model;
    this._sidecarRoot = sidecarRoot;
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
    // Push updated model + deltas into the open panel
    if (this._view) {
      this._view.update(this._model, this._deltas);
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
    return buildScratchpadHtml(this._model, this._deltas);
  }

  async askForStructure(): Promise<void> {
    // ALWAYS gapFiller, regardless of model.phase
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

  /** Reveal an existing panel or create a new one. */
  revealPanel(): void {
    if (!_extensionUri) {
      // No extension URI available (e.g., pure unit test context) — skip panel.
      return;
    }
    if (!this._view) {
      this._view = new ScratchpadDocumentView();
    }
    this._view.show(_extensionUri, this._model, this._deltas, (action) =>
      this.dispatch(action),
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
    if (!this._sidecarRoot) return; // in-memory session — flush() is a no-op
    const dir = nodePath.join(this._sidecarRoot, "scratchpad");
    await nodeFs.mkdir(dir, { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(dir, "current.json"),
      serialize(this._model),
      "utf8",
    );
  }
}

// ===== Public API =====

/**
 * Open (or reveal) the Scratchpad panel — viewType "thinkubeScratchpad",
 * title "Thinkube Scratchpad" — bound to the session.
 *
 * Cold-start: if `<sidecarRoot>/scratchpad/current.json` exists it is
 * deserialize()d as the model (one path serves panel-reopen AND
 * extension-host-restart resume); else emptyModel("tep").
 *
 * The command `thinkube.scratchpad.open` calls this with no deps.
 */

/**
 * openScratchpad's promise means "the panel IS open": VS Code's tab model
 * reflects createWebviewPanel asynchronously, so resolving before the tab is
 * observable makes the caller see a shown panel that tabGroups does not list
 * yet (one tick of falsehood — seen live on SP-21/2 AC-1). Bounded poll; a
 * context with no panel (no extension URI) skips it.
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

export async function openScratchpad(
  deps?: ScratchpadSessionDeps,
): Promise<ScratchpadSession> {
  // Reuse the existing in-memory session when no deps are provided (user button
  // press / panel re-open within the same extension host session).
  if (!deps && _session) {
    _session.revealPanel();
    await awaitPanelVisible();
    return _session;
  }

  // Resolve sidecar root from deps or VS Code setting.
  const sidecarRoot =
    deps?.sidecarRoot ??
    (vscode.workspace
      .getConfiguration("thinkube.thinkingSpace")
      .get<string>("root")
      ?.trim() ||
      undefined);

  // Cold-start: deserialize from disk if possible, else start fresh.
  let model: WorkingModel = emptyModel("tep");
  if (sidecarRoot) {
    try {
      const text = await nodeFs.readFile(
        nodePath.join(sidecarRoot, "scratchpad", "current.json"),
        "utf8",
      );
      model = deserialize(text);
    } catch {
      // File not found or unreadable — use the empty model.
    }
  }

  // Resolve worker model id.
  const workerModel =
    deps?.workerModel ??
    vscode.workspace
      .getConfiguration("thinkube.orchestrator")
      .get<string>("workerModel") ??
    "sonnet";

  // Resolve loadQuery — default is a no-op factory (tests inject their own;
  // real production wiring requires SDK integration not in scope for SP-2).
  const loadQueryFn: () => QueryFn =
    deps?.loadQuery ??
    ((): QueryFn => (_args) =>
      // Empty async iterable: AsyncGenerator<never> is assignable to
      // AsyncIterable<WorkerMessage> because never extends WorkerMessage.
      (async function* () {
        /* yields nothing */
      })());

  const session = new ScratchpadSessionImpl(
    model,
    sidecarRoot,
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
