// src/scratchpad/session.ts — the held Scratchpad session (TEP-21/SP-3).
import * as vscode from "vscode";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";

import { emptyModel, reduce } from "./model";
import type { Action, Delta, SectionKind, WorkingModel } from "./model";
import { entriesOf, isAttributed } from "./model";
import { deserialize, serialize } from "./persistence";
import {
  explainer,
  gapFiller,
  integrator,
  linker,
  makeProductionQueryFnThunk,
} from "./workers/worker";
import { reframe } from "./workers/reframe";
import { research, makeDefaultDossierStore } from "./workers/research";
import type { DossierStore, ResearchTarget } from "./workers/research";
export type { DossierStore } from "./workers/research";
import type { QueryFn } from "./workers/worker";
import { createLoop } from "./loop";
import { buildScratchpadHtml } from "./views/document";
import { BoardView } from "./views/board";
import type { BoardOptions } from "./views/board";
import type { RoundActivity, ScratchpadInboundMessage } from "./views/document";
import { interpret } from "./workers/interpreter";
import { freeze as doFreeze } from "./freeze";
import {
  projectDelta,
  projectCut,
  journalCoverage,
  impactCoverage,
} from "./projection";
import type { ApprovalToken, SigningTool } from "./freeze";
export type { SigningTool } from "./freeze";
import { toReadinessRecord, makeProductionRunSlicer } from "./dryRunSlice";
import type { DryRunResult, SlicerVerdict } from "./dryRunSlice";
import { makeServerSigningTool } from "./freeze";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { workerLogEnabled } from "../services/workerLog";
import { appendLogFile, scratchpadChannel } from "./output";
import { runContextualizeAsk } from "./workers/contextualizer";
import { runImpactPass, type EntryFinding } from "./workers/impact";
import { thinkyDiag } from "./chat/diag";
import {
  candidateRepoSources,
  contextSourcesForSpace,
} from "./productContext";
import { runChallenger } from "./workers/challenger";
import { describeRevisionPlan, planRevision } from "./revision";
import {
  groupItemIds,
  repairWorker,
  journalEntries,
  EXPANSION_STAGES,
  expansionStageWorker,
  askElementsWorker,
  askSectionWorker,
  stampAskEdges,
  stampServesEntry,
  type AskSection,
} from "./workers/expansionPipeline";
import { computeIntegrity, integritySummary } from "./integrityGate";
import { runGapClose, openGaps } from "./workers/gapClose";
import { showFreshMarkdownPreview } from "../commands/freshPreview";
export type { DryRunResult, SlicerVerdict } from "./dryRunSlice";

// Re-export so callers can import the message type from session / index.
export type { ScratchpadInboundMessage } from "./views/document";

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
   * Reveal the webview panel on open (default true). The chat session
   * binding (2026-07-17) opens spaces SILENTLY — a chat request must not
   * yank the webview panel into focus.
   */
  reveal?: boolean;
  /**
   * Injectable worker query factory (a test injects a fake QueryFn).
   */
  loadQuery?: () => QueryFn;
  /**
   * Non-committing dry-run slicer (wired by SL-4).
   * Returns at minimum { cleanCut, gapSection } — the session builds the
   * ReadinessRecord from those two fields plus its own coverage check.
   * Typed as SlicerVerdict (not the full DryRunResult) so injected fakes that
   * omit the `decomposition` field are structurally assignable.
   */
  runSlicer?: (intent: string) => Promise<SlicerVerdict>;
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
  /**
   * Outcome text of the last routed command (what the panel shows under the
   * command field). The @thinky chat participant reads it to reply (Phase C).
   */
  readonly lastCommandMessage: string | undefined;
  /** Identity: which document this session holds (chat binding, 2026-07-17). */
  readonly namespace: string;
  readonly space: string;
  /** Items currently STAGED for action (selection-for-action, ephemeral).
   *  The chat mouth reads it to offer the apply-verb buttons. */
  readonly selectionCount: number;
  /** The staged ids themselves (board selection == chat staging, 2026-07-17). */
  readonly selectedItemIds: readonly string[];
  /** Reveal the board panel (preserveFocus keeps the caret where it is). */
  revealPanel(preserveFocus?: boolean): void;
  /** The DECLARED context sources the contextualize round reads — fixed by
   *  the session, not chooseable per run (agent grounding, 2026-07-17). */
  readonly contextSources: readonly string[];
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

/**
 * Lazy "Thinkube Scratchpad" output channel — created on first logged line,
 * and only when `thinkube.workers.logToOutput` is enabled (config read live,
 * so toggling works without a reload). Worker streams are debugging gold but
 * must never occupy the Output panel by default.
 */
function scratchpadLog(line: string): void {
  if (!workerLogEnabled()) return;
  // Mirror to the shared file (one place carries streaming + diagnostics) and
  // the output channel. The file makes a field round diagnosable without the
  // Output panel; stamped so it interleaves chronologically with [thinky].
  appendLogFile(`${new Date().toISOString()} ${line}`);
  scratchpadChannel()?.appendLine(line);
}

/** Reveal the "Thinkube Scratchpad" output (without stealing keyboard focus)
 *  so the human doesn't have to hunt the Output panel to watch a round. */
function revealScratchpad(): void {
  if (!workerLogEnabled()) return;
  try {
    scratchpadChannel()?.show(true);
  } catch {
    /* no output channel (test host) */
  }
}

// ===== Session implementation =====

/**
 * Human-batch trigger types: actions that trigger an automatic integrator
 * round after a debounce delay (SP-21/3 contract).
 */
const HUMAN_BATCH_TRIGGERS = new Set([
  "resolveEdit",
  "editItemText",
  "addItem",
]);

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
  /** Model for the JUDGMENT round (gap-close): a stronger model than the
   *  volume workers, mirroring the orchestrator's "judgment on Opus, volume on
   *  Sonnet" split. Defaults to "opus". */
  private readonly _judgeModelId: string;
  private readonly _dossier: DossierStore | undefined;
  private readonly _now: () => Date;
  private readonly _runSlicer:
    ((intent: string) => Promise<SlicerVerdict>) | undefined;
  private readonly _signing: SigningTool | undefined;
  private _view: BoardView | undefined;

  /** Tracks whether any worker round is currently in flight. */
  private _roundInFlight = false;
  /** Debounce timer for the automatic integrator round. */
  private _integratorDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  /** Current round activity (for panel rendering). */
  private _roundActivity: RoundActivity | undefined;
  /** Whether a command interpretation round is currently in flight. */
  private _commandInFlight = false;
  /** Ephemeral UI selection (item ids) — the first step of the two-step
   *  destructive flow. Never persisted; pruned of dead ids on apply. */
  private _selection: Set<string> = new Set();
  /** A journal wording being drafted before it is committed (revision). */
  private _revisionDraft: { entry: number; text: string } | undefined;
  /** The latest round's accusations against journal entries themselves. */
  private _entryConcerns: EntryFinding[] = [];
  /** Ephemeral dependency-focus item id (transient inspection highlight). */
  private _focusItemId: string | undefined;
  /** The CUT (third selection channel, 2026-07-16 redesign): element ids
   *  selected to ship as the next TEP. Ephemeral until frozen. */
  private _cut: Set<string> = new Set();
  /** Scope of the LAST curation ("space" or "cut") — labels the curated-intent
   *  panel so a cut-scoped synthesis is never mistaken for the whole space's. */
  private _curatedScope: "space" | "cut" | undefined;
  /** The last command error/explanation message (cleared on the next command attempt). */
  private _commandMessage: string | undefined;

  constructor(
    model: WorkingModel,
    sidecarRoot: string | undefined,
    namespace: string,
    space: string,
    workerModelId: string,
    loadQueryFn: () => QueryFn,
    dossier?: DossierStore,
    now?: () => Date,
    runSlicer?: (intent: string) => Promise<SlicerVerdict>,
    signing?: SigningTool,
    judgeModelId?: string,
  ) {
    this._model = model;
    this._sidecarRoot = sidecarRoot;
    this._namespace = namespace;
    this._space = space;
    this._workerModelId = workerModelId;
    this._judgeModelId = judgeModelId ?? "opus";
    this._loadQueryFn = loadQueryFn;
    this._dossier = dossier;
    this._now = now ?? (() => new Date());
    this._runSlicer = runSlicer;
    this._signing = signing;
  }

  get model(): WorkingModel {
    return this._model;
  }

  get deltas(): Delta[] {
    return this._deltas;
  }

  get lastCommandMessage(): string | undefined {
    return this._commandMessage;
  }

  get namespace(): string {
    return this._namespace;
  }

  get selectionCount(): number {
    return this._selection.size;
  }

  /** Elements currently in the TEP cut — lets the chat know which phase the
   *  space is in (a cut is what makes readiness meaningful). */
  get cutCount(): number {
    return this._cut.size;
  }

  get selectedItemIds(): readonly string[] {
    return [...this._selection];
  }

  get contextSources(): readonly string[] {
    // Product-scoped (2026-07-18 field defect: workspaceFolders[0] was the
    // emptiest root of a 4-folder workspace — structurally blind to the
    // code). Context = the repositories under the space's PRODUCT tier,
    // plus the space's own sidecar (methodology memory). Fully structural,
    // never user-typed.
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
      name: f.name,
      path: f.uri.fsPath,
    }));
    return contextSourcesForSpace(
      this._sidecarRoot,
      this._namespace,
      folders,
      this._model.contextScope,
    );
  }

  /** The product's candidate repositories — what a scope selection picks FROM. */
  private _candidateRepos(): string[] {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
      name: f.name,
      path: f.uri.fsPath,
    }));
    return candidateRepoSources(this._sidecarRoot, this._namespace, folders);
  }

  /**
   * Present the product's candidate repositories for the human to SELECT which
   * the context rounds should read (2026-07-18). A native multi-select,
   * pre-checked by the current scope (or all). Persists via setContextScope.
   * Returns true if a selection was made (false = cancelled).
   */
  async scopeContext(): Promise<boolean> {
    const candidates = this._candidateRepos();
    if (candidates.length <= 1) return true; // nothing to narrow
    const current = new Set(this._model.contextScope ?? candidates);
    const picks = candidates.map((p) => ({
      label: nodePath.basename(p),
      description: p,
      picked: current.has(p),
      _path: p,
    }));
    const chosen = await vscode.window.showQuickPick(picks, {
      canPickMany: true,
      title: "Context — which repositories should the space read?",
      placeHolder: "Uncheck the ones this space does not touch",
    });
    if (!chosen) return false; // cancelled
    this.dispatch({
      type: "setContextScope",
      actor: "human",
      paths: chosen.map((c) => c._path),
    });
    this._commandMessage = `Context scope: ${chosen.length} of ${candidates.length} repositories.`;
    this._updatePanel();
    return true;
  }

  get space(): string {
    return this._space;
  }

  dispatch(action: Action): Delta {
    // Backstop: the reducer throws on runtime-invalid data (unknown action
    // type, unknown section/item id). Upstream seams normalize worker output,
    // but nothing invalid may EVER crash a round or reach the webview as a raw
    // error — convert any residual throw into a rejected delta (model unchanged).
    let model: WorkingModel;
    let delta: Delta;
    try {
      ({ model, delta } = reduce(this._model, action));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[dispatch] reducer threw for action.type=${(action as { type?: string }).type}: ${reason}`,
      );
      model = this._model;
      delta = { kind: "rejected", action, reason };
    }
    this._model = model;
    this._deltas.push(delta);
    // Notify listeners
    for (const listener of this._listeners) {
      listener(this._model);
    }
    // Push updated model into the open panel (board, 2026-07-17)
    if (this._view) {
      this._view.update(this._model, this._boardOptions());
    }
    // Debounce-persist to disk
    this._scheduleFlush();

    // Schedule automatic integrator round after human-batch actions
    if (HUMAN_BATCH_TRIGGERS.has(action.type) && delta.kind === "applied") {
      this._scheduleIntegratorRound();
    }

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
    const allEvidence = this._model.sections.flatMap((s) =>
      s.items.flatMap((it) =>
        it.evidence.map((ev) => `${it.id}:${ev.dossierRef ?? "NO-REF"}`),
      ),
    );
    console.error(
      `[renderedHtml] items with evidence: ${JSON.stringify(allEvidence)}`,
    );
    return buildScratchpadHtml(
      this._model,
      undefined,
      this._roundActivity,
      this._commandMessage,
      this._commandInFlight,
      [...this._selection],
      this._focusItemId,
      [...this._cut],
      this._curatedScope,
    );
  }

  /**
   * Run the GAP-FILLING worker (gapFiller) on the full model.
   * Wired to the prefill{} message.
   *
   * Per-section activity: ALL non-goal sections + goal are targeted.
   * The prefill button carries disabled while the round is in flight.
   */
  async askForStructure(): Promise<void> {
    await this._runWorkerRound(
      "prefill",
      // Target all non-goal section kinds
      this._model.sections.filter((s) => s.kind !== "goal").map((s) => s.kind),
      async () => {
        const worker = gapFiller({
          loadQuery: this._loadQueryFn,
          model: this._workerModelId,
        });
        const loop = createLoop({ workerFor: () => worker });
        return loop.step(this._model, []);
      },
    );
  }

  /**
   * Staged expansion pipeline (expansion redesign 2026-07-18). Runs the four
   * derivation stages in sequence — elements → constraints → gap → acceptance
   * — each as its own worker round so the board/chat shows the progression and
   * each later stage reads the items the earlier ones just landed. Stages 2–4
   * record their own `requires` edges to the elements (the orphan/cut/risk
   * machinery all hang off those edges).
   */
  async expandStaged(): Promise<void> {
    revealScratchpad();
    // Offer the scope picker first when the human has not narrowed and there
    // is more than one candidate repo — expand reads context from the scoped
    // sources, so narrowing here keeps each ask's read fast and on-target.
    if (
      this._model.contextScope === undefined &&
      this._candidateRepos().length > 1
    ) {
      const ok = await this.scopeContext();
      if (!ok) {
        this._commandMessage = "Expansion cancelled — no context scope chosen.";
        this._updatePanel();
        return;
      }
    }
    // GLOBAL PASSES (2026-07-18 ask-anchor rebuild): contextualize the whole
    // journal, then ONE pass per section — elements, constraints, gap,
    // acceptance — over ALL elements at once (no per-ask re-walking). Every
    // section item is stamped `servesEntry` (its ask) deterministically from
    // the element it derives from, so orphans are impossible by construction.
    const asks = journalEntries(this._model);
    const canContext = !!this._dossier && !!this._sidecarRoot;
    // INCREMENTAL (2026-07-18): entries already derived are left alone. Adding
    // an entry to an expanded space derives only that entry — a full re-walk
    // costs another whole expand and risks re-inflating the space.
    const alreadyDerived = new Set(this._model.derivedEntries ?? []);
    const targetAsks = asks
      .map((text, i) => ({ n: i + 1, text }))
      .filter((a) => !alreadyDerived.has(a.n));
    const isIncremental = alreadyDerived.size > 0;
    if (targetAsks.length === 0) {
      this._commandMessage =
        "Every journal entry is already derived — add a new entry, or close gaps / settle on the board.";
      this._updatePanel();
      return;
    }

    // 1. Context: one focused digest per journal ask (auditable at
    //    research/<space>/_ask-<n>.md); each ask's own digest grounds its
    //    elements round, the union grounds the global section passes.
    const askDigests = new Map<number, string>();
    if (canContext) {
      const assumptions = (this._model.assumptions ?? []).map((a) => a.text);
      for (const [idx, ask] of targetAsks.entries()) {
        this._commandMessage = `Reading context — entry ${ask.n} (${idx + 1}/${targetAsks.length})…`;
        this._updatePanel();
        const res = await runContextualizeAsk(
          {
            loadQuery: this._loadQueryFn,
            model: this._judgeModelId,
            dossier: this._dossier!,
            sources: [...this.contextSources],
            log: scratchpadLog,
          },
          ask.n,
          ask.text,
          assumptions,
        );
        if (res?.text) askDigests.set(ask.n, res.text);
      }
    }
    const digest = await this._readDigest();
    const elementsSecId =
      this._model.sections.find((s) => s.kind === "elements")?.id ?? "";

    // 2. ELEMENTS — one round PER ASK. Each ask's subject matter is DISTINCT,
    //    so this is not the redundant part (that was re-deriving the sections
    //    per ask, which stay global below). Per-ask here is the forcing
    //    function: a single global pass silently derived only the first ask.
    for (const [idx, ask] of targetAsks.entries()) {
      const askNum = ask.n;
      this._commandMessage = `Deriving elements — entry ${askNum} (${idx + 1}/${targetAsks.length})…`;
      this._updatePanel();
      await this._runWorkerRound(`ask${askNum}:elements`, ["elements"], async () => {
        const worker = askElementsWorker(askNum, ask.text, {
          loadQuery: this._loadQueryFn,
          model: this._workerModelId,
          contextDigest: askDigests.get(askNum) ?? digest,
        });
        const actions = await createLoop({ workerFor: () => worker }).step(
          this._model,
          [],
        );
        // This round KNOWS its ask — stamp it rather than guessing a default.
        return actions.map((a) =>
          a.type === "proposeItem" && a.sectionId === elementsSecId
            ? { ...a, item: { ...a.item, servesEntries: [askNum] } }
            : a,
        );
      });
      // Record it as derived so a later expand skips it.
      this.dispatch({ type: "markEntryDerived", entry: askNum });
    }

    // 3. COVERAGE GATE: an ask that produced no elements is either a genuine
    //    refinement ask or a missed derivation — surface it, never hide it.
    const perAsk = new Map<number, number>();
    for (const it of this._model.sections.find((s) => s.kind === "elements")
      ?.items ?? [])
      if (it.state === "active" && isAttributed(it))
        for (const e of entriesOf(this._model, it))
          perAsk.set(e, (perAsk.get(e) ?? 0) + 1);
    const uncoveredAsks = asks
      .map((_, i) => i + 1)
      .filter((n) => !perAsk.has(n));
    if (uncoveredAsks.length) {
      scratchpadLog(
        `━━ coverage: ask(s) ${uncoveredAsks.join(", ")} produced NO elements`,
      );
    }

    // 4. SECTIONS.
    const sectionStages = EXPANSION_STAGES.filter(
      (s) => s !== "elements",
    ) as AskSection[];
    const liveElements = () =>
      (this._model.sections.find((s) => s.kind === "elements")?.items ?? [])
        .filter((it) => it.state === "active")
        .map((it) => ({
          id: it.id,
          text: it.text,
          serves: entriesOf(this._model, it)[0] ?? 1,
        }));

    if (!isIncremental) {
      // FULL expand: ONE global pass each over ALL elements (this is where the
      // per-ask re-walking used to multiply the space). Each item is anchored
      // to its ask via the element it derives from.
      for (const stage of sectionStages) {
        this._commandMessage = `Expanding — ${stage}…`;
        this._updatePanel();
        await this._runWorkerRound(`expand:${stage}`, [stage], async () => {
          const worker = expansionStageWorker(stage, {
            loadQuery: this._loadQueryFn,
            model: this._workerModelId,
            contextDigest: digest,
          });
          const actions = await createLoop({ workerFor: () => worker }).step(
            this._model,
            [],
          );
          return stampServesEntry(actions, liveElements());
        });
      }
    } else {
      // INCREMENTAL: derive each NEW entry's sections scoped to ITS elements —
      // or, when the entry only refines what exists (no new elements), scoped
      // to the live elements it bounds. Derived entries are never re-walked.
      for (const ask of targetAsks) {
        const all = liveElements();
        const own = all.filter((e) => e.serves === ask.n);
        const isRefinement = own.length === 0;
        const scope = (isRefinement ? all : own).map((e) => ({
          id: e.id,
          text: e.text,
        }));
        if (scope.length === 0) continue; // nothing to hang sections off yet
        for (const section of sectionStages) {
          this._commandMessage = `Entry ${ask.n}: ${section}…`;
          this._updatePanel();
          await this._runWorkerRound(
            `entry${ask.n}:${section}`,
            [section],
            async () => {
              const worker = askSectionWorker(
                section,
                ask.n,
                scope,
                ask.text,
                {
                  loadQuery: this._loadQueryFn,
                  model: this._workerModelId,
                  contextDigest: askDigests.get(ask.n) ?? digest,
                },
                isRefinement,
              );
              const actions = await createLoop({ workerFor: () => worker }).step(
                this._model,
                [],
              );
              // Edges to the elements it bounds, and the anchor is THIS entry —
              // the entry that caused the item to exist.
              return stampAskEdges(
                actions,
                scope.map((e) => e.id),
              ).map((a) =>
                a.type === "proposeItem"
                  ? { ...a, item: { ...a.item, servesEntries: [ask.n] } }
                  : a,
              );
            },
          );
        }
      }
    }

    // 5. IMPACT — only when adding to an already-derived space. A new entry can
    //    contradict or supersede what is already committed; without this the
    //    space would hold both and freeze a contradiction. Findings are
    //    annotated onto the affected items and STAGED for the human to resolve
    //    (keep / drop / supersede) — the machine never applies the verdict.
    let impactNote = "";
    if (isIncremental) {
      this._commandMessage = "Checking impact on the existing space…";
      this._updatePanel();
      const report = await runImpactPass(
        {
          model: this._judgeModelId,
          contextDigest: digest,
          effort: "high",
          log: scratchpadLog,
        },
        this._model,
        targetAsks,
      );
      for (const f of report.findings) {
        this.dispatch({
          type: "addItemNote",
          actor: "research",
          itemId: f.itemId,
          text: `Impact — ${f.kind} by journal entr${targetAsks.length === 1 ? "y" : "ies"} ${targetAsks
            .map((a) => a.n)
            .join(", ")}: ${f.why}`,
        });
      }
      if (report.findings.length > 0) {
        this._selection = new Set(report.findings.map((f) => f.itemId));
        impactNote =
          `⚠ ${report.findings.length} existing item(s) collide with the new entry — ` +
          `staged for you (see the note on each): keep, drop, or supersede. `;
      }
      if (report.askConflicts.length > 0) {
        impactNote +=
          `⚠ The new entry conflicts with: ${report.askConflicts.join("; ")}. `;
      }
      // The upward channel: the round may find the ENTRY itself at fault.
      // Nothing is applied — the wording is the human's, so this only offers.
      this._entryConcerns = report.entryFindings;
      if (report.entryFindings.length > 0) {
        impactNote +=
          `⚠ ${report.entryFindings.length} journal entr` +
          `${report.entryFindings.length === 1 ? "y is" : "ies are"} themselves ` +
          `questionable (${report.entryFindings.map((f) => `entry ${f.entry}: ${f.kind}`).join("; ")}) — ` +
          `ask Thinky to revise them. `;
      }
    }

    // Backstop repair: an unplaced item is not broken (it serves the whole
    // space), but narrower is better — try to tie it to the element it serves,
    // or promote a mislabeled one into elements. Best-effort, never a blocker.
    let integrity = computeIntegrity(this._model);
    if (integrity.unattributed.length > 0) {
      this._commandMessage = `Placing — ${integrity.unattributed.length} unplaced item(s)…`;
      this._updatePanel();
      const orphans = integrity.unattributed;
      await this._runWorkerRound(
        "repair",
        ["elements", "constraints", "gap", "acceptance"],
        async () => {
          const worker = repairWorker({
            loadQuery: this._loadQueryFn,
            model: this._workerModelId,
            contextDigest: digest,
            orphans,
          });
          const loop = createLoop({ workerFor: () => worker });
          return loop.step(this._model, []);
        },
      );
      integrity = computeIntegrity(this._model);
    }
    // Gap-close (judgment path on the judge model): resolves researchable
    // gaps, DECIDES the decidable ones into constraints, and recommends a
    // decision on each genuine intent fork for the human to ratify. Re-reads
    // the digest (no arg) so it judges the fresh per-ask digests just written.
    await this.closeOpenGaps();
    const counts = this._model.sections
      .filter((s) => s.kind !== "goal")
      .map((s) => `${s.kind} ${s.items.filter((it) => it.state === "active").length}`)
      .join(" · ");
    this._commandMessage =
      `${isIncremental ? "Derived new entries" : "Expansion complete"} — ${counts}. ` +
      `${integritySummary(integrity)} ` +
      impactNote +
      (uncoveredAsks.length
        ? `⚠ Journal entr${uncoveredAsks.length === 1 ? "y" : "ies"} ${uncoveredAsks.join(", ")} produced NO elements — ` +
          `either they only refine existing ones, or the derivation missed them; check before cutting. `
        : "") +
      `Review on the board; nothing is settled yet.`;
    scratchpadLog(
      `━━ integrity: ${integrity.unattributed.length} unplaced, ${integrity.uncoveredElements.length} uncovered, ${integrity.duplicates.length} dup-pairs`,
    );
    this._updatePanel();
  }

  /** The last expansion's integrity report (for surfaces to render). */
  computeIntegrity() {
    return computeIntegrity(this._model);
  }

  /**
   * Run the gap-close round standalone (also invoked by expandStaged). Reads
   * the product sources, closes researchable gaps, recommends decisions.
   * Re-runnable at any time (2026-07-18): a "close gaps" trigger.
   */
  async closeOpenGaps(digest?: string): Promise<void> {
    revealScratchpad();
    const dg = digest ?? (await this._readDigest());
    const gapsToClose = openGaps(this._model);
    thinkyDiag(
      `gap-close: openGaps=${gapsToClose.length} sidecar=${!!this._sidecarRoot} sources=${this.contextSources.length}`,
    );
    if (gapsToClose.length === 0) {
      this._commandMessage = "No open gaps to close.";
      this._updatePanel();
      return;
    }
    if (!this._sidecarRoot) {
      this._commandMessage =
        "Gap-close needs a thinking-space root (sources unavailable).";
      this._updatePanel();
      return;
    }
    this._commandMessage = `Closing gaps — judging ${gapsToClose.length} open question(s) on ${this._judgeModelId}…`;
    this._updatePanel();
    const constraintsBefore = this._model.sections
      .find((s) => s.kind === "constraints")!
      .items.filter((it) => it.state === "active").length;
    let produced = 0;
    await this._runWorkerRound("gap-close", ["gap", "constraints"], async () => {
      const actions = await runGapClose(
        {
          model: this._judgeModelId,
          sources: [...this.contextSources],
          contextDigest: dg,
          now: this._now,
          effort: "high",
          log: scratchpadLog,
        },
        this._model,
      );
      produced = actions.length;
      thinkyDiag(
        `gap-close: round produced ${actions.length} action(s) [${actions.map((a) => a.type).join(",")}]`,
      );
      return actions;
    });
    const resolved = this._model.sections
      .find((s) => s.kind === "gap")!
      .items.filter((it) => it.state === "resolved").length;
    const decided =
      this._model.sections
        .find((s) => s.kind === "constraints")!
        .items.filter((it) => it.state === "active").length - constraintsBefore;
    const forks = this._model.sections
      .find((s) => s.kind === "gap")!
      .items.filter((it) => it.state === "active" && it.decisionProposal).length;
    this._commandMessage =
      produced === 0
        ? "Gap-close ran but closed nothing — the round returned no actions (see the Thinkube Scratchpad log). Try again, or the gaps may need your input."
        : `Gap-close done: ${resolved} resolved, ${decided} decided into constraints (review/override on the board), ${forks} intent fork(s) awaiting your Ratify.`;
    this._updatePanel();
  }

  /**
   * Run the REFRAME worker.
   * Wired to the reframe{} message.
   *
   * The reframe prompt contains checked items only (no unchecked text), and
   * the gate allows exactly one action — curateIntent. The human's own goal
   * text is never touched: reframe writes the curated intent beside it.
   */
  // ── Revision (2026-07-23) ───────────────────────────────────────────────
  // Rewording an ask is destructive, so it is a two-beat act: the wording is
  // drafted and argued over for free, then committed once. The draft lives on
  // the session (not the model) — an abandoned draft leaves no trace.

  /** The wording currently being drafted, if any. */
  get revisionDraft(): { entry: number; text: string } | undefined {
    return this._revisionDraft;
  }

  /** Journal entries a round has flagged as themselves at fault. */
  get entryConcerns(): readonly EntryFinding[] {
    return this._entryConcerns;
  }

  /** Hold a proposed wording for an entry and describe what applying it costs. */
  stageRevision(entry: number, text: string): string {
    const plan = planRevision(this._model, entry);
    if (plan.refusal) return `Cannot revise: ${plan.refusal}`;
    if (!text.trim()) return "Give the new wording for the entry.";
    this._revisionDraft = { entry, text: text.trim() };
    this._updatePanel();
    return `${describeRevisionPlan(plan, text.trim())}\n\nNothing has changed yet — say the word to apply it, or keep refining the wording.`;
  }

  discardRevision(): string {
    const had = this._revisionDraft !== undefined;
    this._revisionDraft = undefined;
    this._updatePanel();
    return had ? "Revision draft discarded." : "There was no revision draft.";
  }

  /**
   * Judge the DRAFT against the space without committing it: the same impact
   * pass the incremental derivation runs, pointed at a wording that does not
   * exist yet. Nothing is annotated or staged — this only reports.
   */
  async dryRunRevision(): Promise<string> {
    const draft = this._revisionDraft;
    if (!draft) return "No revision draft to test.";
    revealScratchpad();
    this._commandMessage = `Testing the revision of entry ${draft.entry}…`;
    this._updatePanel();
    // The entry's own subtree is about to be deleted, so collisions with it
    // are noise; judge the draft against what would SURVIVE.
    const plan = planRevision(this._model, draft.entry);
    const doomed = new Set(plan.purge.map((h) => h.id));
    const survivors: WorkingModel = {
      ...this._model,
      sections: this._model.sections.map((s) => ({
        ...s,
        items: s.items.filter((it) => !doomed.has(it.id)),
      })),
    };
    const report = await runImpactPass(
      {
        model: this._judgeModelId,
        contextDigest: await this._readDigest(),
        effort: "high",
        log: scratchpadLog,
      },
      survivors,
      [{ n: draft.entry, text: draft.text }],
    );
    this._commandMessage = undefined;
    this._updatePanel();
    const lines: string[] = [];
    if (report.findings.length === 0 && report.askConflicts.length === 0)
      return "Dry run: the new wording collides with nothing that survives the revision.";
    if (report.findings.length > 0) {
      lines.push(
        `${report.findings.length} surviving item(s) would collide with the new wording:`,
      );
      for (const f of report.findings) {
        const it = this._model.sections
          .flatMap((s) => s.items)
          .find((x) => x.id === f.itemId);
        const shipped = it?.state === "shipped" ? " [SHIPPED — cannot change]" : "";
        lines.push(`  - ${f.kind}${shipped}: ${it?.text ?? f.itemId} — ${f.why}`);
      }
    }
    if (report.askConflicts.length > 0)
      lines.push(`The wording itself conflicts with: ${report.askConflicts.join("; ")}`);
    lines.push("Nothing has been changed — this was a dry run.");
    return lines.join("\n");
  }

  /**
   * Commit the drafted revision: delete what the old wording produced (sparing
   * shipped/protected items), rewrite the entry, and send it back for
   * derivation. The re-derivation runs the normal incremental path, so the
   * impact pass judges the new wording against the rest of the space.
   */
  async applyRevision(): Promise<string> {
    const draft = this._revisionDraft;
    if (!draft) return "No revision draft to apply.";
    const plan = planRevision(this._model, draft.entry);
    if (plan.refusal) return `Cannot revise: ${plan.refusal}`;

    if (plan.purge.length > 0) {
      const delta = this.dispatch({
        type: "purgeItems",
        actor: "human",
        itemIds: plan.purge.map((h) => h.id),
      });
      if (delta.kind !== "applied")
        return `Revision aborted — ${(delta as { reason?: string }).reason ?? "the purge was refused"}. Nothing changed.`;
    }
    const rewrite: Action =
      plan.requestId === undefined
        ? { type: "editGoal", text: draft.text }
        : {
            type: "editRoughRequest",
            actor: "human",
            requestId: plan.requestId,
            text: draft.text,
          };
    const wrote = this.dispatch(rewrite);
    if (wrote.kind !== "applied")
      return `Revision aborted — ${(wrote as { reason?: string }).reason ?? "the rewrite was refused"}.`;
    // Shared items stay, but stop claiming to serve the ask whose wording no
    // longer produced them. Re-derivation may re-attach them on the new words.
    for (const h of plan.shared) {
      this.dispatch({
        type: "setItemEntries",
        actor: "gap-filler",
        itemId: h.id,
        entries: h.servesEntries.filter((e) => e !== draft.entry),
      });
    }
    // Back into the queue: the entry is now underived, so expand walks it alone.
    this.dispatch({ type: "unmarkEntryDerived", entry: draft.entry });
    this._revisionDraft = undefined;
    this._selection.clear();
    const purged = plan.purge.length;
    const kept = plan.preserved.length + plan.shared.length;
    this._commandMessage =
      `Entry ${draft.entry} revised — ${purged} derived item(s) deleted` +
      `${kept > 0 ? `, ${kept} kept (shipped, protected, or serving another ask)` : ""}. Re-deriving…`;
    this._updatePanel();
    await this.expandStaged();
    return (
      `Entry ${draft.entry} rewritten and re-derived. Deleted ${purged} item(s) from the old wording` +
      `${kept > 0 ? `; kept ${kept} that a frozen TEP shipped or protects, or that other asks still need` : ""}.`
    );
  }

  async runReframe(): Promise<void> {
    const cutScoped = this._cut.size > 0;
    await this._runWorkerRound("reframe", ["goal"], async () => {
      // With a cut active, the curated intent is synthesized for the CUT —
      // it describes the upcoming TEP, not the whole space.
      const scope = cutScoped
        ? { itemIds: this._cutClosureIds() }
        : undefined;
      const worker = reframe(
        {
          loadQuery: this._loadQueryFn,
          model: this._workerModelId,
          contextDigest: await this._readDigest(),
        },
        scope,
      );
      return worker.run(this._model, []);
    });
    if (this._model.curatedIntent?.trim()) {
      this._curatedScope = cutScoped ? "cut" : "space";
      this._updatePanel();
    }
  }

  /**
   * Run the RESEARCH worker for a specific item or a free subject.
   * Wired to the research{} message.
   *
   * Dossier-first: reads the dossier BEFORE any query round; existing markdown
   * is included verbatim in the prompt. Findings land as unchecked proposals
   * plus evidence chips with method, date, and dossierRef.
   */
  async runResearch(target: ResearchTarget): Promise<void> {
    // Use the injected/default dossier store, or fall back to an in-memory
    // no-op store so research always runs (findings and chips still land).
    const dossier: DossierStore = this._dossier ?? {
      async read(_topic: string) {
        return undefined;
      },
      async write(topic: string, _markdown: string) {
        return { dossierRef: `research/${topic}.md` };
      },
    };

    // Target all non-goal sections (research may propose items to any of them)
    const targetedKinds = this._model.sections
      .filter((s) => s.kind !== "goal")
      .map((s) => s.kind);

    console.error(
      `[runResearch] calling _runWorkerRound, target=${JSON.stringify(target)}`,
    );
    await this._runWorkerRound("research", targetedKinds, async () => {
      console.error(`[runResearch work()] building worker and calling run`);
      const worker = research(
        {
          loadQuery: this._loadQueryFn,
          dossier,
          now: this._now,
          sidecarRoot: this._sidecarRoot,
          namespace: this._namespace,
        },
        target,
      );
      const result = await worker.run(this._model, []);
      console.error(
        `[runResearch work()] run() returned ${result.length} actions`,
      );
      return result;
    });
    console.error(`[runResearch] _runWorkerRound complete`);
    const modelEvidence = this._model.sections.flatMap((s) =>
      s.items.flatMap((it) =>
        it.evidence.map((ev) => `${it.id}:${ev.dossierRef ?? "NO-REF"}`),
      ),
    );
    console.error(
      `[runResearch] after round, model evidence: ${JSON.stringify(modelEvidence)}, total items: ${this._model.sections.reduce((n, s) => n + s.items.length, 0)}`,
    );
    // Flush immediately: the research round writes a dossier to disk, so the
    // model (with evidence chips) must also be persisted now rather than waiting
    // for the 500ms debounce — a host restart in a multi-phase probe would
    // otherwise lose the chips before phase 1 reads them back.
    await this.flush();
  }

  /**
   * Run the INTEGRATOR worker automatically after a debounced human batch.
   * Never runs concurrently with another round.
   */
  private async _runIntegratorRound(): Promise<void> {
    if (this._roundInFlight) {
      // Another round is in flight — skip this automatic trigger.
      return;
    }
    const targetKinds = this._model.sections
      .filter((s) => s.kind !== "goal")
      .map((s) => s.kind);
    await this._runWorkerRound("integrator", targetKinds, async () => {
      const worker = integrator({
        loadQuery: this._loadQueryFn,
        model: this._workerModelId,
      });
      return worker.run(this._model, []);
    });
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
          // The message MAY carry a modality; preserve it when present.
          ...((message as { modality?: "mandatory" | "optional" }).modality
            ? {
                modality: (message as { modality?: "mandatory" | "optional" })
                  .modality,
              }
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
        if (
          (message.facet !== "complexity" && message.facet !== "risk") ||
          ![1, 2, 3].includes(message.value)
        ) {
          break;
        }
        if (
          (message.facet !== "complexity" && message.facet !== "risk") ||
          ![1, 2, 3].includes(message.value)
        ) {
          break;
        }
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
      case "resolveItem":
        this.dispatch({
          type: "resolveItem",
          actor: "human",
          itemId: message.itemId,
        });
        break;
      case "acceptEval":
        this.dispatch({
          type: "acceptEval",
          actor: "human",
          itemId: message.itemId,
          facet: message.facet,
          reason: message.reason,
        });
        break;
      case "dropItem":
        this.dispatch({
          type: "dropItem",
          actor: "human",
          itemId: message.itemId,
        });
        break;
      case "explainItem": {
        // Targeted re-explain for one item (the bulk path is explainAll).
        const secOfItem = this._model.sections.find((s) =>
          s.items.some((it) => it.id === message.itemId),
        );
        if (!secOfItem) break;
        await this._runWorkerRound("explain", [secOfItem.kind], async () => {
          const worker = explainer(
            { loadQuery: this._loadQueryFn, model: this._workerModelId },
            [message.itemId],
          );
          return worker.run(this._model, []);
        });
        break;
      }
      case "explainAll": {
        // ONE round annotates every active item that has no note yet —
        // never a round per item (field refinement 2026-07-16).
        const targets: string[] = [];
        const kinds = new Set<SectionKind>();
        // Only a Why-shaped note counts as an explanation — research findings
        // and other annotations must not exempt an item from explanation
        // (field defect 2026-07-16: items with notes but no Why were skipped).
        const hasExplanation = (notes: { text: string }[]): boolean =>
          notes.some((n) => /^\s*Why\s*:/i.test(n.text));
        for (const sec of this._model.sections) {
          if (sec.kind === "goal") continue;
          for (const it of sec.items) {
            if (it.state === "active" && !hasExplanation(it.notes)) {
              targets.push(it.id);
              kinds.add(sec.kind);
            }
          }
        }
        if (targets.length === 0) {
          this._commandMessage =
            "Every active item already carries an explanation.";
          this._updatePanel();
          break;
        }
        await this._runWorkerRound("explain", [...kinds], async () => {
          // Verify-and-retry (field defect 2026-07-16: partial coverage
          // landed silently as success): run once, compute the targets the
          // worker actually covered from its returned actions, retry the
          // missed ones ONCE, then let the honest count surface below.
          const worker = explainer(
            { loadQuery: this._loadQueryFn, model: this._workerModelId },
            targets,
          );
          const actions = await worker.run(this._model, []);
          const covered = new Set(
            actions
              .filter((a) => a.type === "addItemNote")
              .map((a) => (a as { itemId: string }).itemId),
          );
          const missed = targets.filter((id) => !covered.has(id));
          if (missed.length === 0) return actions;
          const retry = explainer(
            { loadQuery: this._loadQueryFn, model: this._workerModelId },
            missed,
          );
          try {
            const retryActions = await retry.run(this._model, []);
            return [...actions, ...retryActions];
          } catch {
            // Retry produced nothing usable — land what the first pass got;
            // the honest completion message below names the shortfall.
            return actions;
          }
        });
        // Honest completion report: never let partial coverage read as done.
        const stillMissing = this._model.sections.reduce(
          (n, sec) =>
            sec.kind === "goal"
              ? n
              : n +
                sec.items.filter(
                  (it) =>
                    targets.includes(it.id) &&
                    it.state === "active" &&
                    !hasExplanation(it.notes),
                ).length,
          0,
        );
        this._commandMessage =
          stillMissing === 0
            ? `Explained ${targets.length} item${targets.length === 1 ? "" : "s"}.`
            : `Explained ${targets.length - stillMissing} of ${targets.length} items — ${stillMissing} still lack an explanation (run Explain again, or use the per-item "why?").`;
        this._updatePanel();
        break;
      }
      case "suggestLinks": {
        // One blind round proposes requires edges between existing items —
        // the path for pre-edge spaces whose cuts pull zero context.
        const kinds = new Set<SectionKind>();
        for (const sec of this._model.sections) {
          if (sec.kind !== "goal" && sec.items.length > 0) kinds.add(sec.kind);
        }
        if (kinds.size === 0) break;
        await this._runWorkerRound("link", [...kinds], async () => {
          const worker = linker({
            loadQuery: this._loadQueryFn,
            model: this._workerModelId,
            contextDigest: await this._readDigest(),
          });
          return worker.run(this._model, []);
        });
        const edges = this._model.sections.reduce(
          (n, sec) =>
            n + sec.items.reduce((m, it) => m + (it.requires?.length ?? 0), 0),
          0,
        );
        this._commandMessage = `Link round done — ${edges} edge${edges === 1 ? "" : "s"} now declared in the space.`;
        this._updatePanel();
        break;
      }
      case "openEvidence": {
        // Evidence chips open their backing artifact: the dossier (rendered
        // markdown) when present, else the source URL.
        try {
          if (message.dossierRef && this._sidecarRoot) {
            const abs = nodePath.join(
              this._sidecarRoot,
              this._namespace,
              message.dossierRef,
            );
            await showFreshMarkdownPreview(vscode.Uri.file(abs));
          } else if (/^https?:\/\//.test(message.source)) {
            await vscode.env.openExternal(vscode.Uri.parse(message.source));
          } else {
            vscode.window.showInformationMessage(
              `Evidence source: ${message.source}`,
            );
          }
        } catch (err) {
          vscode.window.showErrorMessage(
            `Could not open evidence: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        break;
      }
      case "panic": {
        // The panic button: restart the DERIVATION, keep the human's words
        // (journal + assumptions) and on-disk research artifacts. Reducer
        // refuses after any freeze. Native modal confirmation.
        const choice = await vscode.window.showWarningMessage(
          "Panic — wipe everything derived (items, edges, evals, curated intent, readiness) and keep only your journal, assumptions, and research files?",
          { modal: true },
          "Wipe derived state",
        );
        if (choice !== "Wipe derived state") break;
        const delta = this.dispatch({ type: "panicReset", actor: "human" });
        if (delta.kind === "applied") {
          this._selection.clear();
          this._cut.clear();
          this._focusItemId = undefined;
          this._curatedScope = undefined;
          this._commandMessage =
            "Panic applied — journal and assumptions kept; everything derived wiped. Add an entry or run Prefill to re-derive.";
        } else {
          this._commandMessage = `Panic refused: ${(delta as { reason: string }).reason}`;
        }
        this._updatePanel();
        break;
      }
      case "scopeContext": {
        await this.scopeContext();
        break;
      }
      case "contextualize": {
        // The context layer: a read-only round over the SCOPED sources writes
        // the digest dossier — the sanctioned context channel. Offer the
        // scope picker first when the human has not narrowed and there is
        // more than one candidate repo (2026-07-18).
        if (
          this._model.contextScope === undefined &&
          this._candidateRepos().length > 1
        ) {
          const ok = await this.scopeContext();
          if (!ok) break; // cancelled the picker → abort contextualize
        }
        if (!this._dossier) {
          this._commandMessage =
            "Contextualize needs a thinking-space root (no dossier store available).";
          this._updatePanel();
          break;
        }
        // Product-scoped sources (2026-07-18): the repositories under this
        // space's PRODUCT tier + the space's own sidecar — mirrors the spec
        // doctrine (specs bind to one repo; the product bounds the context).
        const sources = [...this.contextSources];
        if (sources.length === 0) {
          this._commandMessage =
            "Contextualize has no sources: no repositories found under this space's product (sidecar cards + workspace folders resolve none).";
          this._updatePanel();
          break;
        }
        scratchpadLog(
          `contextualize sources (product-scoped): ${sources.join(", ")}`,
        );
        // OPTIONAL PREVIEW (2026-07-18): standalone contextualize regenerates
        // the SAME per-ask digests expand_space folds in — so what the human
        // previews is exactly what derivation will inject. It is for
        // auditability/debugging, NOT a ceremonial gate: expand runs it anyway.
        await this._runWorkerRound("contextualize", ["goal"], async () => {
          const asks = journalEntries(this._model);
          const assumptions = (this._model.assumptions ?? []).map((a) => a.text);
          const refs: string[] = [];
          for (let i = 0; i < asks.length; i++) {
            this._commandMessage = `Contextualizing ask ${i + 1}/${asks.length}…`;
            this._updatePanel();
            const res = await runContextualizeAsk(
              {
                loadQuery: this._loadQueryFn,
                model: this._workerModelId,
                dossier: this._dossier!,
                sources,
                log: scratchpadLog,
              },
              i + 1,
              asks[i],
              assumptions,
            );
            if (res?.ref) refs.push(res.ref);
          }
          this._commandMessage = refs.length
            ? `Contextualized ${refs.length}/${asks.length} ask${asks.length === 1 ? "" : "s"} — open each rendered digest from the board (research/_ask-<n>.md). Expand folds these in automatically.`
            : "Contextualize produced no digests (rounds failed) — try again; the space stays context-blind until it succeeds.";
          return [];
        });
        this._updatePanel();
        break;
      }
      case "removeNote":
        this.dispatch({
          type: "removeNote",
          actor: "human",
          itemId: message.itemId,
          noteId: message.noteId,
        });
        break;
      case "addRoughRequest": {
        // Append-only journal of raw human asks (2026-07-16 redesign). The
        // FIRST entry seeds the goal — one input, no special first-run
        // ceremony (2026-07-17). NO auto-expansion (guided-flow field defect
        // 2026-07-17: the agent journaled the first intake message verbatim
        // and this seam immediately decomposed the whole space, violating
        // "the human triggers the derivation" — expansion now runs ONLY via
        // the explicit prefill/expand_space act).
        const goalIsEmpty = !(
          this._model.sections.find((s) => s.kind === "goal")?.text ?? ""
        ).trim();
        this.dispatch(
          goalIsEmpty
            ? { type: "seedGoal", text: message.text }
            : { type: "addRoughRequest", text: message.text },
        );
        break;
      }
      case "toggleCut": {
        // The CUT — third selection channel: elements selected to ship as
        // the next TEP. Distinct from checked (settled) and staged (verb
        // pending). Only ELEMENT items can enter a cut.
        const inElements = this._model.sections.some(
          (s) =>
            s.kind === "elements" &&
            s.items.some(
              (it) => it.id === message.itemId && it.state === "active",
            ),
        );
        if (!inElements) break;
        if (this._cut.has(message.itemId)) {
          this._cut.delete(message.itemId);
        } else {
          this._cut.add(message.itemId);
        }
        this._updatePanel();
        break;
      }
      case "clearCut":
        this._cut.clear();
        this._updatePanel();
        break;
      case "previewTep": {
        // DRAFT preview (2026-07-16 redesign): render EXACTLY what freeze
        // would sign — same projection, zero side effects (no TEP id, no
        // flags, no stamps). Opens as an untitled markdown document.
        const cutActive = this._cut.size > 0;
        const proj = cutActive
          ? projectCut(this._model, { elementIds: [...this._cut] })
          : projectDelta(this._model);
        const warnings: string[] = [];
        const impact = impactCoverage(
          this._model,
          cutActive ? [...this._cut] : undefined,
        );
        for (const b of impact.blockers) warnings.push(`PRECISION: ${b}`);
        const cov = journalCoverage(this._model);
        if (cov.total > 0) {
          warnings.push(
            cov.served.length > 0
              ? `Journal coverage: the intent serves entr${cov.served.length === 1 ? "y" : "ies"} ${cov.served.join(", ")} of ${cov.total}${cov.remaining.length ? ` — entr${cov.remaining.length === 1 ? "y" : "ies"} ${cov.remaining.join(", ")} remain in the space` : " — all entries served"}.`
              : "Journal coverage: the intent carries NO [serves:] traces — run Reframe (v0.1.242+) to regenerate it with traced commitments.",
          );
        }
        if (cutActive) {
          const cutProj = proj as ReturnType<typeof projectCut>;
          if (cutProj.uncheckedElements.length > 0) {
            warnings.push(
              `${cutProj.uncheckedElements.length} selected element(s) are NOT settled — freeze will refuse until they are checked.`,
            );
          }
          warnings.push(
            `Cut scope: ${cutProj.shipIds.length} element(s) ship; ${cutProj.flagIds.length} context item(s) get flagged and stay live.`,
          );
        }
        const draft =
          `<!-- DRAFT — not signed; nothing shipped or flagged. This preview runs the SAME projection freeze signs. -->\n\n` +
          `# DRAFT TEP — ${proj.title || "(untitled)"}\n\n` +
          (warnings.length > 0
            ? warnings.map((w) => `> ⚠ ${w}`).join("\n") + "\n\n"
            : "") +
          proj.body +
          `\n`;
        try {
          // RENDERED preview, like spec approval (field defect 2026-07-17:
          // an untitled editor demanded "save?" on close). The draft lands in
          // a scratch file (overwritten every preview, never signed) and
          // opens through the same fresh markdown preview the spec flow uses.
          if (this._sidecarRoot) {
            const dir = nodePath.join(
              this._sidecarRoot,
              this._namespace,
              "thinking",
              ".previews",
            );
            await nodeFs.mkdir(dir, { recursive: true });
            const file = nodePath.join(dir, `${this._space}.draft.md`);
            await nodeFs.writeFile(file, draft, "utf8");
            await showFreshMarkdownPreview(vscode.Uri.file(file));
          } else {
            const doc = await vscode.workspace.openTextDocument({
              content: draft,
              language: "markdown",
            });
            await vscode.window.showTextDocument(doc, { preview: true });
          }
        } catch (err) {
          vscode.window.showErrorMessage(
            `Preview failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        break;
      }
      case "toggleDepFocus":
        // Transient dependency-focus highlight (illumination channel —
        // distinct from checked/settled and from staged-for-action).
        this._focusItemId =
          this._focusItemId === message.itemId ? undefined : message.itemId;
        this._updatePanel();
        break;
      // ── Selection flow (2026-07-16): step 1 selects, step 2 applies ──────
      case "toggleSelect":
        if (this._selection.has(message.itemId)) {
          this._selection.delete(message.itemId);
        } else {
          this._selection.add(message.itemId);
        }
        this._updatePanel();
        break;
      case "clearSelection":
        this._selection.clear();
        this._commandMessage = undefined;
        this._updatePanel();
        break;
      case "applySelection": {
        // Apply the chosen verb to every SELECTED item that still exists and
        // is active; the selection is the human's explicit staging area, the
        // click on the verb is the settling act.
        const verbToAction: Record<
          "check" | "uncheck" | "defer" | "drop",
          "checkItem" | "uncheckItem" | "deferItem" | "dropItem"
        > = {
          check: "checkItem",
          uncheck: "uncheckItem",
          defer: "deferItem",
          drop: "dropItem",
        };
        const actionType = verbToAction[message.verb];
        if (!actionType) break;
        const liveIds = new Set(
          this._model.sections.flatMap((s) =>
            s.items
              .filter((it) => it.state === "active")
              .map((it) => it.id),
          ),
        );
        let applied = 0;
        for (const itemId of [...this._selection]) {
          if (!liveIds.has(itemId)) continue;
          this.dispatch({ type: actionType, actor: "human", itemId });
          applied++;
        }
        if (
          this._focusItemId !== undefined &&
          this._selection.has(this._focusItemId) &&
          (message.verb === "drop" || message.verb === "defer")
        ) {
          this._focusItemId = undefined;
        }
        this._selection.clear();
        this._commandMessage =
          applied > 0
            ? `Applied ${message.verb} to ${applied} item${applied === 1 ? "" : "s"}.`
            : "Selection had no live items — nothing applied.";
        this._updatePanel();
        break;
      }
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

      // ── Worker round triggers ─────────────────────────────────────────────
      case "prefill":
        // Staged expansion pipeline (2026-07-18): elements → constraints →
        // gaps → acceptance, each stage deriving from the last and recording
        // its own edges. Replaces the single flat gapFiller round.
        await this.expandStaged();
        break;
      case "reframe":
        // Runs reframe worker; prompt carries checked items only.
        // Guard (2026-07-16): with NOTHING checked, a reframe would rewrite the
        // intent from an empty set — the worker returns a blank and the author's
        // goal is erased (field defect, first real session). Refuse in place.
        if (
          !this._model.sections.some((sec) =>
            (sec.items ?? []).some((it) => it.checked && it.state === "active"),
          )
        ) {
          this._roundActivity = {
            state: "failed",
            targetedKinds: ["goal"],
            errors: {
              goal: "Nothing is settled yet — check at least one item before reframing; the intent is rewritten FROM the checked items.",
            },
          };
          this._updatePanel();
          break;
        }
        await this.runReframe();
        break;
      case "research":
        // Run the research worker for a specific item or a free subject.
        await this.runResearch({
          itemId: message.itemId,
          subject: message.subject,
        });
        break;
      case "checkReadiness":
        // Run the dry-run slicer and record readiness — the ONLY path that
        // writes a ReadinessRecord; freeze enablement reads the latest record.
        if (this._runSlicer) {
          try {
            // Call the slicer directly (not via dryRunSlice) so that the
            // SlicerVerdict type (a minimal subset of DryRunResult) works with
            // injected fakes that omit `decomposition`.
            // The judged text is the goal PLUS the settled (checked, active)
            // items per section — freeze signs the checked items, so judging
            // the bare goal alone could neither see nor explain a
            // section-level gap (2026-07-16).
            const goalSec = this._model.sections.find((s) => s.kind === "goal");
            // NUMBERED journal — the judge's north star.
            const journal = [
              ...((goalSec?.text ?? "").trim() ? [goalSec!.text.trim()] : []),
              ...(this._model.roughRequests ?? []).map((r) => r.text),
            ];
            const lines: string[] = [
              "Journal (the human's raw asks, numbered — the north star):",
              ...journal.map((t, i) => `${i + 1}. ${t}`),
            ];
            // Cut-scoped readiness (2026-07-17): with a cut active, the
            // verdict judges THE CUT — its closure and its curated intent —
            // not the whole space.
            const cutScope =
              this._cut.size > 0 ? this._cutClosureIds() : undefined;
            if (cutScope) {
              lines.push(
                `\nNOTE: this readiness run is CUT-SCOPED — only the items below ship in the next TEP; unlisted journal entries may legitimately remain for future cuts (they are NOT gaps unless the intent claims them).`,
              );
            }
            for (const [i, a] of (this._model.assumptions ?? []).entries()) {
              lines.push(
                `${i === 0 ? "\nStanding assumptions (human statements — contradiction = gap):\n" : ""}A${i + 1}. ${a.text}`,
              );
            }
            const digestText = await this._readDigest();
            if (digestText) {
              lines.push(`\nContext digest (what exists — contradiction = gap):\n${digestText.slice(0, 4000)}`);
            }
            if (this._model.curatedIntent?.trim()) {
              lines.push(`\nCurated intent:\n${this._model.curatedIntent.trim()}`);
            }
            for (const sec of this._model.sections) {
              if (sec.kind === "goal") continue;
              const checked = sec.items.filter(
                (it) =>
                  it.checked &&
                  it.state === "active" &&
                  (cutScope === undefined || cutScope.has(it.id)),
              );
              if (checked.length > 0) {
                lines.push(`\n${sec.kind} (settled):`);
                for (const it of checked) {
                  const ev: string[] = [];
                  if (it.evals.complexity !== undefined)
                    ev.push(`complexity ${it.evals.complexity}`);
                  if (it.evals.risk !== undefined)
                    ev.push(`risk ${it.evals.risk}`);
                  lines.push(
                    `- ${it.text}${ev.length ? ` [${ev.join(", ")}]` : ""}`,
                  );
                }
              }
            }
            // Unsettled MANDATORY items are disclosed to the judge: modality
            // feeds no hard mechanism (the human stays sovereign over the
            // labels), but the readiness verdict must be able to see and
            // flag a proposed-required item that nobody settled or resolved.
            const unsettledMandatory = this._model.sections.flatMap((sec) =>
              sec.kind === "goal"
                ? []
                : sec.items
                    .filter(
                      (it) =>
                        it.modality === "mandatory" &&
                        it.state === "active" &&
                        !it.checked,
                    )
                    .map((it) => `- [${sec.kind}] ${it.text}`),
            );
            if (unsettledMandatory.length > 0) {
              lines.push(
                `\nUnsettled MANDATORY items (proposed as required, but the human has neither settled nor reclassified them — judge whether the intent is deliverable while these are unresolved):`,
              );
              lines.push(...unsettledMandatory);
            }
            const verdict = await this._runSlicer(lines.join("\n"));
            const record = toReadinessRecord(this._model, verdict);
            this.dispatch({ type: "recordReadiness", record });
          } catch {
            // Slicer failure: record as not-ready, clean-cut failed with no gap
            this.dispatch({
              type: "recordReadiness",
              record: { covered: false, cleanCut: false, gapSection: null },
            });
          }
        }
        break;
      case "freeze":
        // The freeze{} message arrival MINTS the ApprovalToken (human-by-construction).
        // Pipeline: assert freezeEnabled → projectDelta → stamp → writeTep(proposed)
        //           → stampShipped → save
        // Every outcome is SURFACED (field defect 2026-07-16: failures were
        // swallowed silently and success gave no pointer to the created TEP).
        if (this._signing) {
          const approval: ApprovalToken = {
            value: `human-approval-${Date.now()}`,
          };
          try {
            const cut =
              this._cut.size > 0
                ? { elementIds: [...this._cut] }
                : undefined;
            const { tep, itemIds, flagIds } = await doFreeze(
              this._model,
              {
                approval,
                signing: this._signing,
                thinkingSpace: this._space,
              },
              cut,
            );
            this.dispatch({
              type: "stampShipped",
              itemIds,
              tepId: tep,
              ...(flagIds.length > 0 ? { flagIds } : {}),
            });
            this._cut.clear();
            await this.flush();
            const fcov = journalCoverage(this._model);
            vscode.window.showInformationMessage(
              (cut
                ? `${tep} created from the cut: ${itemIds.length} element(s) shipped, ${flagIds.length} context item(s) flagged (still live for future cuts).`
                : `${tep} created (status: proposed) — it is now in this thinking space's TEPs panel.`) +
                (fcov.remaining.length > 0
                  ? ` Journal entries ${fcov.remaining.join(", ")} remain open in the space.`
                  : ""),
            );
            // Best-effort tree refresh so the new TEP is visible immediately.
            void vscode.commands
              .executeCommand("thinkube.thinkingSpace.refresh")
              .then(undefined, () => undefined);
          } catch (err) {
            vscode.window.showErrorMessage(
              `Freeze failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        } else {
          vscode.window.showErrorMessage(
            "Freeze unavailable: no signing tool is wired. Set THINKUBE_SIGNING_KEY_DIR and reload the window.",
          );
        }
        break;
      case "setSelection": {
        // The board's ONE selection (2026-07-17 redesign): replaces the whole
        // set. Ids are validated against live items; unknown ids are dropped.
        const known = new Set<string>();
        for (const sec of this._model.sections)
          for (const it of sec.items) known.add(it.id);
        this._selection = new Set(
          (message.itemIds ?? []).filter((id) => known.has(id)),
        );
        this._updatePanel();
        break;
      }
      case "parkGroup": {
        // Parking (2026-07-18): defer an entire journal-entry group — its
        // elements + their private derived items — to postpone that
        // functionality for a later TEP. Shared context stays live.
        const ids = groupItemIds(this._model, message.entry);
        if (ids.length === 0) {
          this._commandMessage = `Nothing to park for journal entry ${message.entry} (no elements serve it yet).`;
          this._updatePanel();
          break;
        }
        for (const itemId of ids) {
          this.dispatch({ type: "deferItem", actor: "human", itemId });
        }
        this._commandMessage = `Parked journal entry ${message.entry}: ${ids.length} item${ids.length === 1 ? "" : "s"} deferred (supersede or re-open any time).`;
        this._updatePanel();
        break;
      }
      case "removeJournalEntry": {
        // Sovereign correction of a RECORDING ERROR (2026-07-17): verbatim
        // capture can fossilize meta-wrappers; the human may delete an entry
        // after a modal confirmation. Workers have no path here.
        const entry = (this._model.roughRequests ?? []).find(
          (r) => r.id === message.requestId,
        );
        if (!entry) break;
        const choice = await vscode.window.showWarningMessage(
          `Delete journal entry "${entry.text.slice(0, 120)}${entry.text.length > 120 ? "…" : ""}"? This removes it from the verbatim record.`,
          { modal: true },
          "Delete entry",
        );
        if (choice !== "Delete entry") break;
        const delta = this.dispatch({
          type: "removeRoughRequest",
          actor: "human",
          requestId: message.requestId,
        });
        this._commandMessage =
          delta.kind === "applied"
            ? "Journal entry deleted."
            : `Delete refused: ${(delta as { reason: string }).reason}`;
        this._updatePanel();
        break;
      }
      case "setCutFromSelection": {
        // The cut is a RESULT of the selection, not a rival selection mode.
        const elements = new Set(
          this._model.sections
            .filter((s) => s.kind === "elements")
            .flatMap((s) => s.items)
            .filter((it) => it.state === "active")
            .map((it) => it.id),
        );
        const chosen = [...this._selection].filter((id) => elements.has(id));
        const skipped = this._selection.size - chosen.length;
        if (chosen.length === 0) {
          this._commandMessage =
            "Cut unchanged — the selection contains no active elements (cuts ship ELEMENTS; context is pulled by the closure).";
        } else {
          this._cut = new Set(chosen);
          this._commandMessage = `Cut set: ${chosen.length} element${chosen.length === 1 ? "" : "s"}${
            skipped > 0 ? ` (${skipped} non-element selection item${skipped === 1 ? "" : "s"} left out — context joins via edges)` : ""
          }. Ask Thinky to check readiness, or Freeze when the gate is green.`;
        }
        this._updatePanel();
        break;
      }
      case "askThinky": {
        try {
          await vscode.commands.executeCommand("workbench.action.chat.open", {
            query: "@thinky ",
            isPartialQuery: true,
          });
        } catch {
          /* no chat surface — board remains usable */
        }
        break;
      }
      case "command": {
        // SL-5: interpret the utterance, dispatch returned actions, render message.
        const utterance = message.utterance;
        // Round-trigger commands (field request 2026-07-16): worker rounds are
        // not expressible as item actions, so the interpreter's gate can never
        // reach them — recognize them deterministically here instead.
        const lowered = utterance.trim().toLowerCase();
        // Phase acts the chat's buttons emit — routed deterministically here
        // rather than hoping the agent interprets a button's utterance.
        if (
          lowered === "expand" ||
          lowered === "expand space" ||
          lowered === "expand_space"
        ) {
          this._commandMessage = undefined;
          this._updatePanel();
          await this.postFromWebview({ type: "prefill" });
          break;
        }
        if (lowered === "freeze") {
          await this.postFromWebview({ type: "freeze" });
          break;
        }
        if (lowered === "open board" || lowered === "board") {
          this.revealPanel();
          this._commandMessage = "Board revealed — settle, ratify, or cut there.";
          this._updatePanel();
          break;
        }
        if (lowered === "reframe" || lowered.startsWith("reframe ")) {
          this._commandMessage = undefined;
          this._updatePanel();
          await this.postFromWebview({ type: "reframe" });
          break;
        }
        if (
          lowered === "check readiness" ||
          lowered === "readiness" ||
          lowered === "dry run" ||
          lowered === "dry-run"
        ) {
          this._commandMessage = undefined;
          this._updatePanel();
          await this.postFromWebview({ type: "checkReadiness" });
          break;
        }
        if (lowered === "clear selection" || lowered === "deselect all") {
          await this.postFromWebview({ type: "clearSelection" });
          break;
        }
        if (lowered === "panic") {
          await this.postFromWebview({ type: "panic" });
          break;
        }
        if (lowered === "contextualize" || lowered === "context") {
          await this.postFromWebview({ type: "contextualize" });
          break;
        }
        if (lowered === "close gaps" || lowered === "closegaps") {
          this._commandMessage = undefined;
          this._updatePanel();
          await this.closeOpenGaps();
          break;
        }
        if (
          lowered === "scope" ||
          lowered === "select context" ||
          lowered === "scope context"
        ) {
          await this.scopeContext();
          break;
        }
        // Clear prior message, mark in-flight, update panel to disable the field.
        this._commandMessage = undefined;
        this._commandInFlight = true;
        this._updatePanel();
        try {
          const result = await interpret(utterance, this._model, {
            loadQuery: this._loadQueryFn,
          });
          // Dispatch all returned actions (each carries actor:"human")
          for (const action of result.actions) {
            this.dispatch(action);
          }
          // Classifier routing (2026-07-17): statements become standing
          // assumptions (+ challenger); asks become journal entries
          // (+ expansion); questions get a respond-only answer.
          if (result.classify === "statement") {
            const delta = this.dispatch({
              type: "addAssumption",
              text: utterance,
            });
            if (delta.kind === "applied") {
              let staged: string[] = [];
              const digest = await this._readDigest();
              await this._runWorkerRound(
                "challenge",
                this._model.sections
                  .filter((s) => s.kind !== "goal" && s.items.length > 0)
                  .map((s) => s.kind),
                async () => {
                  const res = await runChallenger(
                    {
                      loadQuery: this._loadQueryFn,
                      model: this._workerModelId,
                      contextDigest: digest,
                    },
                    this._model,
                  );
                  staged = res.selectedItemIds;
                  return res.actions;
                },
              );
              if (staged.length > 0) {
                this._selection = new Set(staged);
              }
              this._commandMessage = `Recorded as standing assumption #${(this._model.assumptions ?? []).length}. ${
                staged.length > 0
                  ? `${staged.length} item(s) conflict with it — staged for your review (selection bar).`
                  : "No existing items conflict with it."
              }`;
            } else {
              this._commandMessage = `Assumption refused: ${(delta as { reason: string }).reason}`;
            }
            this._commandInFlight = false;
            this._updatePanel();
            break;
          }
          if (result.classify === "ask") {
            this._commandInFlight = false;
            this._updatePanel();
            await this.postFromWebview({
              type: "addRoughRequest",
              text: utterance,
            });
            this._commandMessage =
              "Recorded as a journal entry — the expansion round is absorbing it.";
            this._updatePanel();
            break;
          }
          if (result.classify === "question") {
            const { runQuestionAnswer } = await import(
              "./workers/contextualizer"
            );
            const answer = await runQuestionAnswer(
              { model: this._workerModelId },
              utterance,
              this._model,
              await this._readDigest(),
            );
            this._commandMessage = answer
              ? answer.slice(0, 800)
              : "Could not produce an answer — try rephrasing.";
            this._commandInFlight = false;
            this._updatePanel();
            break;
          }
          // Selection-for-action: the command STAGED items — distinct from
          // checking (settling). The verb is applied from the selection bar
          // as a separate human act.
          if (result.selectedItemIds && result.selectedItemIds.length > 0) {
            this._selection = new Set(result.selectedItemIds);
            const n = result.selectedItemIds.length;
            this._commandMessage =
              result.message ??
              `${n} item${n === 1 ? "" : "s"} staged for action — apply a verb from the selection bar (or "clear selection"). Staging is not checking: nothing enters the TEP from this.`;
          } else {
            // Render the message (if any) under the command field
            this._commandMessage = result.message;
          }
        } catch (err) {
          this._commandMessage =
            err instanceof Error ? err.message : String(err);
        } finally {
          this._commandInFlight = false;
          this._updatePanel();
        }
        break;
      }
    }
  }

  /** Reveal an existing panel or create a new one (the board). */
  revealPanel(preserveFocus = false): void {
    if (!_extensionUri) {
      return;
    }
    if (!this._view) {
      this._view = new BoardView();
    }
    this._view.show(
      _extensionUri,
      this._model,
      this._boardOptions(),
      (msg) => this.postFromWebview(msg),
      preserveFocus,
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Run a named worker round with full activity tracking:
   *  1. Mark round as in-flight (sets data-activity="running" on targeted sections,
   *     disables prefill/reframe buttons).
   *  2. Await the worker; apply every returned action through dispatch.
   *  3. On success: flip targeted sections to data-activity="landed".
   *  4. On error: flip to data-activity="failed", render <div class="round-error">
   *     inside each targeted section.
   *  5. Clear in-flight flag.
   *
   * NEVER runs concurrently: if _roundInFlight is already true, resolves immediately
   * (the automatic integrator path checks before calling; explicit triggers always run).
   */
  private async _runWorkerRound(
    roundName: string,
    targetedKinds: SectionKind[],
    work: () => Promise<Action[]>,
  ): Promise<void> {
    // Mark as running
    this._roundInFlight = true;
    revealScratchpad();
    scratchpadLog(`━━ ${roundName} round starting (targets: ${targetedKinds.join(", ")})`);
    this._roundActivity = {
      targetedKinds,
      errors: {},
      state: "running",
      label: roundName,
    };
    this._updatePanel();

    try {
      const actions = await work();
      // Clear activity BEFORE dispatching actions so that any view.update()
      // triggered by dispatch() already shows the post-round state ("landed"
      // with no running indicator — rendered as data-activity="landed").
      scratchpadLog(`━━ ${roundName} round landed`);
      this._roundActivity = {
        targetedKinds,
        errors: {},
        state: "landed",
        label: roundName,
      };
      this._roundInFlight = false;
      // Apply all returned actions (dispatch updates the panel with "landed")
      for (const action of actions) {
        console.error(
          `[_runWorkerRound] dispatching action.type=${action.type}`,
        );
        this.dispatch(action);
      }
      // Final update to ensure the panel reflects the settled landed state
      this._updatePanel();
      return;
    } catch (err) {
      // Mark failed — render error inside each targeted section
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[_runWorkerRound] CAUGHT ERROR: ${errorMsg}`);
      scratchpadLog(`━━ ${roundName} round FAILED: ${errorMsg}`);
      const errors: Partial<Record<SectionKind, string>> = {};
      for (const kind of targetedKinds) {
        errors[kind] = errorMsg;
      }
      this._roundActivity = {
        targetedKinds,
        errors,
        state: "failed",
        label: roundName,
      };
    } finally {
      // Always clear the in-flight flag (may already be cleared in success path)
      this._roundInFlight = false;
      this._updatePanel();
    }
  }

  /** The whole-space context: every per-ask digest (research/<space>/_ask-<n>.md)
   *  concatenated, for rounds that span asks (gap-close, repair, question).
   *  Fail-soft — undefined when none have been written yet. */
  private async _readDigest(): Promise<string | undefined> {
    if (!this._sidecarRoot) return undefined;
    const dir = nodePath.join(
      this._sidecarRoot,
      this._namespace,
      "research",
      this._space,
    );
    let names: string[];
    try {
      names = await nodeFs.readdir(dir);
    } catch {
      return undefined;
    }
    const askFiles = names
      .filter((n) => /^_ask-\d+\.md$/.test(n))
      .sort(
        (a, b) =>
          Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]),
      );
    const parts: string[] = [];
    for (const f of askFiles) {
      try {
        const body = (
          await nodeFs.readFile(nodePath.join(dir, f), "utf8")
        ).trim();
        if (body) parts.push(`## ${f}\n\n${body}`);
      } catch {
        // skip an unreadable digest
      }
    }
    return parts.length ? parts.join("\n\n") : undefined;
  }

  /** Ids inside the current cut: the selected elements plus the context their
   *  edges pull in (via projectCut's traversal). Empty set when no cut. */
  private _cutClosureIds(): Set<string> {
    if (this._cut.size === 0) return new Set();
    const proj = projectCut(this._model, { elementIds: [...this._cut] });
    return new Set([
      ...this._cut,
      ...proj.shipIds,
      ...proj.flagIds,
    ]);
  }

  /** Push the current model + selection/cut/command state into the board. */
  private _updatePanel(): void {
    if (this._view) {
      this._view.update(this._model, this._boardOptions());
    }
  }

  private _boardOptions(): BoardOptions {
    return {
      selection: [...this._selection],
      cut: [...this._cut],
      commandMessage: this._commandMessage,
      busy: this._commandInFlight || this._roundInFlight,
      space: this._space,
    };
  }

  /**
   * Schedule an automatic integrator round after a debounce period.
   * Each human-batch action resets the timer; the round only fires once the
   * human stops making changes for 800ms.
   */
  private _scheduleIntegratorRound(): void {
    if (this._integratorDebounceTimer !== undefined) {
      clearTimeout(this._integratorDebounceTimer);
    }
    this._integratorDebounceTimer = setTimeout(() => {
      this._integratorDebounceTimer = undefined;
      void this._runIntegratorRound();
    }, 800);
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

  // Resolve loadQuery: use injected fake or production SDK thunk
  const loadQueryFn: () => QueryFn =
    deps?.loadQuery ?? makeProductionQueryFnThunk(workerModel, scratchpadLog);

  // Resolve clock: use injected fake or system clock
  const nowFn: () => Date = deps?.now ?? (() => new Date());

  // Resolve dossier store: use injected store or create the default one
  // rooted per space at <sidecarRoot>/<namespace>/research/<space>/
  const dossierStore: DossierStore | undefined =
    deps?.dossier ??
    (sidecarRoot
      ? makeDefaultDossierStore(sidecarRoot, namespace, space)
      : undefined);

  // Resolve runSlicer: injected fake, or the production blind readiness judge.
  // (Wiring gap found in field use 2026-07-16: without a runSlicer no readiness
  // record can ever be written, so freeze could never enable in production.)
  const runSlicerFn =
    deps?.runSlicer ?? makeProductionRunSlicer(workerModel, scratchpadLog);

  // Resolve signing: injected fake, or the production ThinkubeStore-backed tool
  // (same secret mechanism as spec certification — THINKUBE_SIGNING_KEY_DIR).
  // Left undefined when the env or sidecarRoot is missing; the freeze handler
  // then surfaces a loud, actionable error instead of doing nothing.
  let signingTool = deps?.signing;
  if (!signingTool && sidecarRoot) {
    const keyDir = process.env.THINKUBE_SIGNING_KEY_DIR?.trim();
    if (keyDir) {
      const wsRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? sidecarRoot;
      signingTool = makeServerSigningTool(
        new ThinkubeStore(wsRoot, nodePath.join(sidecarRoot, namespace)),
        keyDir,
      );
    }
  }

  const session = new ScratchpadSessionImpl(
    model,
    sidecarRoot,
    namespace,
    space,
    workerModel,
    loadQueryFn,
    dossierStore,
    nowFn,
    runSlicerFn,
    signingTool,
  );
  _session = session;
  if (deps?.reveal !== false) {
    session.revealPanel();
    await awaitPanelVisible();
  }
  return session;
}

/**
 * The session the last openScratchpad created (undefined before the first open).
 */
export function getScratchpadSession(): ScratchpadSession | undefined {
  return _session;
}
