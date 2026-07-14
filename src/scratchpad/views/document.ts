import * as vscode from "vscode";
import type { Delta, Section, SectionState, WorkingModel } from "../model";
import { freezeEnabled } from "../model";

/**
 * The complete inbound message protocol (webview → extension).
 * Every authoring control posts exactly one of these; the session applies
 * each through the one reducer.
 */
export type ScratchpadInboundMessage =
  | { type: "seedGoal"; text: string }
  | { type: "editGoal"; text: string }
  | { type: "editSection"; id: string; text: string }
  | { type: "addNote"; sectionId: string; text: string }
  | { type: "askStructure" };

/** Visual marker for each section state. */
export const STATE_MARKERS: Record<SectionState, string> = {
  empty: "○",
  proposed: "◌",
  shaping: "◑",
  settled: "●",
};

/** Escape HTML special characters. */
function esc(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Serialize any value for display in the delta log. */
function showValue(val: unknown): string {
  if (val === undefined) return "undefined";
  return JSON.stringify(val);
}

/** Render one section as HTML — includes edit-section and add-note controls. */
function sectionHtml(section: Section): string {
  const marker = STATE_MARKERS[section.state];
  const notesHtml =
    section.notes.length > 0
      ? `<div class="notes">${section.notes
          .map((n) => `<div class="note">${esc(n.text)}</div>`)
          .join("")}</div>`
      : "";

  return /* html */ `
<div class="section" data-id="${esc(section.id)}">
  <div class="section-header">
    <span class="state-marker" title="${esc(section.state)}">${marker}</span>
    <span class="kind-label">${esc(section.kind)}</span>
    <span class="state-label">${esc(section.state)}</span>
  </div>
  <div class="section-text">${esc(section.text)}</div>
  ${notesHtml}
  <div class="section-edit-area">
    <textarea class="edit-section-input" data-section-id="${esc(section.id)}">${esc(section.text)}</textarea>
    <button class="edit-section" data-section-id="${esc(section.id)}" onclick="confirmEdit('${esc(section.id)}')">Save edit</button>
  </div>
  <div class="section-add-note-area">
    <input id="note-input-${esc(section.id)}" class="note-input" data-section-id="${esc(section.id)}" type="text" placeholder="Add a note…" />
    <button class="add-note" data-section-id="${esc(section.id)}" onclick="addNote('${esc(section.id)}')">Add note</button>
  </div>
</div>`;
}

/** Render the delta log (before AND after each applied action). */
function deltaLogHtml(deltas: Delta[]): string {
  if (deltas.length === 0) return "";
  const rows = deltas
    .map(
      (d, i) => `
  <div class="delta" data-index="${i}">
    <span class="delta-index">#${i + 1}</span>
    <span class="delta-action">${esc(d.action.type)}</span>
    <span class="delta-field">${esc(d.field)}</span>
    <span class="delta-before">before: ${esc(showValue(d.before))}</span>
    <span class="delta-after">after: ${esc(showValue(d.after))}</span>
  </div>`,
    )
    .join("\n");
  return `<section class="delta-log">
  <h2>Changes (${deltas.length})</h2>
  ${rows}
</section>`;
}

/**
 * Build the full Scratchpad HTML from the current model and delta log.
 *
 * Exported so that ScratchpadSession.renderedHtml() can return the exact same
 * string the webview receives.
 *
 * Contains:
 *  - a Goal textarea (#goal-input) with a confirm control → seedGoal/editGoal
 *  - per section: an edit control (class "edit-section", data-section-id) → editSection
 *  - per section: an add-note control (class "add-note", data-section-id) → addNote
 *  - a button #ask-structure → askStructure
 *  - the Freeze control (<button id="freeze">, disabled iff !freezeEnabled(model))
 *  - the delta log with each delta's before AND after values
 */
export function buildScratchpadHtml(
  model: WorkingModel,
  deltas: Delta[],
): string {
  const goalSec = model.sections.find((s) => s.kind === "goal");
  const goalText = goalSec ? goalSec.text : "";
  const goalWasEmpty = goalText === "";

  const sectionsHtml = model.sections.map(sectionHtml).join("\n");

  const objectionsHtml =
    model.objections.length > 0
      ? `<section class="objections">
          <h2>Objections</h2>
          ${model.objections
            .map(
              (o) =>
                `<div class="objection ${o.resolved ? "resolved" : "open"}">
                  ${esc(o.text)}${o.resolved ? ' <span class="badge">resolved</span>' : ""}
                </div>`,
            )
            .join("\n")}
        </section>`
      : "";

  // Freeze control: disabled attribute PRESENT when freezeEnabled is false,
  // ABSENT when freezeEnabled is true.
  const canFreeze = freezeEnabled(model);
  const freezeBtn = canFreeze
    ? `<button id="freeze">Freeze</button>`
    : `<button id="freeze" disabled>Freeze</button>`;

  const freezeSection = `<section class="freeze-control">
  <h2>Freeze</h2>
  ${freezeBtn}
</section>`;

  const deltaSection = deltaLogHtml(deltas);

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thinkube Scratchpad</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
    h1 { font-size: 1.2em; margin: 0 0 16px; }
    h2 { font-size: 1em; margin-bottom: 8px; }
    .goal-area { margin-bottom: 16px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
    #goal-input { width: 100%; min-height: 60px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 2px; resize: vertical; }
    .goal-area button { margin-top: 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
    .goal-area button:hover { background: var(--vscode-button-hoverBackground); }
    .section { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 12px; padding: 12px; }
    .section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .state-marker { font-size: 1.2em; }
    .kind-label { font-weight: bold; text-transform: capitalize; }
    .state-label { font-size: 0.8em; opacity: 0.7; }
    .section-text { white-space: pre-wrap; margin-bottom: 8px; }
    .notes { margin-left: 12px; font-size: 0.9em; opacity: 0.85; }
    .note { margin-bottom: 4px; padding-left: 8px; border-left: 2px solid var(--vscode-panel-border); }
    .section-edit-area { margin-top: 8px; }
    .edit-section-input { width: 100%; min-height: 60px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 2px; resize: vertical; }
    .edit-section { margin-top: 4px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
    .edit-section:hover { background: var(--vscode-button-hoverBackground); }
    .section-add-note-area { display: flex; gap: 8px; margin-top: 8px; }
    .note-input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 2px; }
    .add-note { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
    .add-note:hover { background: var(--vscode-button-hoverBackground); }
    .structure-area { margin-top: 16px; margin-bottom: 16px; }
    #ask-structure { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 16px; border-radius: 2px; cursor: pointer; }
    #ask-structure:hover { background: var(--vscode-button-hoverBackground); }
    .objections { margin-top: 24px; }
    .objection.open { color: var(--vscode-errorForeground); }
    .badge { font-size: 0.75em; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 6px; border-radius: 8px; }
    .freeze-control { margin-top: 24px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
    #freeze { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 16px; border-radius: 2px; cursor: pointer; }
    #freeze:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    #freeze:disabled { opacity: 0.5; cursor: not-allowed; }
    .delta-log { margin-top: 24px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; font-size: 0.85em; }
    .delta { display: grid; grid-template-columns: 2em 6em 1fr 1fr 1fr; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); }
    .delta-index { opacity: 0.5; }
    .delta-action { font-weight: bold; }
    .delta-field { font-family: monospace; opacity: 0.8; }
    .delta-before { color: var(--vscode-errorForeground); }
    .delta-after { color: var(--vscode-terminal-ansiGreen, green); }
  </style>
</head>
<body>
  <h1>Scratchpad <span style="opacity:0.5;font-size:0.8em;">${esc(model.phase)}</span></h1>
  <section class="goal-area">
    <h2>Goal</h2>
    <textarea id="goal-input">${esc(goalText)}</textarea>
    <button onclick="confirmGoal()">Confirm goal</button>
  </section>
  ${sectionsHtml}
  ${objectionsHtml}
  <section class="structure-area">
    <button id="ask-structure" onclick="askStructure()">Ask for structure</button>
  </section>
  ${freezeSection}
  ${deltaSection}
  <script>
    const vscode = acquireVsCodeApi();
    const goalWasEmpty = ${JSON.stringify(goalWasEmpty)};

    function confirmGoal() {
      const textarea = document.getElementById('goal-input');
      const text = textarea ? textarea.value.trim() : '';
      if (!text) return;
      vscode.postMessage({ type: goalWasEmpty ? 'seedGoal' : 'editGoal', text });
    }

    function confirmEdit(sectionId) {
      const textarea = document.querySelector('.edit-section-input[data-section-id="' + sectionId + '"]');
      const text = textarea ? textarea.value.trim() : '';
      if (!text) return;
      vscode.postMessage({ type: 'editSection', id: sectionId, text });
    }

    function addNote(sectionId) {
      const input = document.getElementById('note-input-' + sectionId);
      const text = input ? input.value.trim() : '';
      if (!text) return;
      vscode.postMessage({ type: 'addNote', sectionId, text });
      if (input) input.value = '';
    }

    function askStructure() {
      vscode.postMessage({ type: 'askStructure' });
    }
  </script>
</body>
</html>`;
}

/**
 * Editable document view for the Scratchpad.
 *
 * Shows every section with its per-section state marker (○ empty / ◌ proposed /
 * ◑ shaping / ● settled), the delta log (before and after each change), and a
 * Freeze control whose enabled state tracks SP-1's freezeEnabled(model).
 * All user interactions post a ScratchpadInboundMessage back through `onMessage`.
 */
export class ScratchpadDocumentView implements vscode.Disposable {
  private _panel: vscode.WebviewPanel | undefined;
  private _disposables: vscode.Disposable[] = [];

  /**
   * Reveal or create the webview panel.
   *
   * @param extensionUri  Extension URI for resource roots.
   * @param model         The current working model.
   * @param deltas        Accumulated deltas for the delta log.
   * @param onMessage     Handler for inbound webview messages; called with the
   *                      SAME `ScratchpadInboundMessage` the webview posts.
   *                      May return a Promise (e.g. for askStructure).
   */
  show(
    extensionUri: vscode.Uri,
    model: WorkingModel,
    deltas: Delta[],
    onMessage: (msg: ScratchpadInboundMessage) => void | Promise<void>,
  ): void {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.One);
      this._panel.webview.html = buildScratchpadHtml(model, deltas);
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      "thinkubeScratchpad",
      "Thinkube Scratchpad",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      },
    );

    this._panel.webview.html = buildScratchpadHtml(model, deltas);

    this._panel.webview.onDidReceiveMessage(
      (msg: ScratchpadInboundMessage) => {
        void onMessage(msg);
      },
      undefined,
      this._disposables,
    );

    this._panel.onDidDispose(
      () => {
        this._panel = undefined;
        this._disposables.forEach((d) => d.dispose());
        this._disposables = [];
      },
      undefined,
      this._disposables,
    );
  }

  /**
   * Push an updated model and delta log into the already-open panel.
   */
  update(model: WorkingModel, deltas: Delta[] = []): void {
    if (this._panel) {
      this._panel.webview.html = buildScratchpadHtml(model, deltas);
    }
  }

  dispose(): void {
    this._panel?.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}
