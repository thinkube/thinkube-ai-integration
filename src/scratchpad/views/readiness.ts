import * as vscode from "vscode";
import type { WorkingModel, SectionKind } from "../model";
import { freezeEnabled } from "../model";
import type { DryRunResult } from "../dryRunSlice";
import { uncoveredSections } from "../coverage";

/** Messages the readiness webview sends to the extension. */
type WebviewMessage = { type: "freeze" };

/**
 * Readiness view for the Scratchpad.
 *
 * Renders three things:
 *   1. Coverage — which sections are still "red" (coverage !== 'verified').
 *   2. Decomposition — the list of work-unit labels returned by the last dry run.
 *   3. Gap pointer — when the dry run cannot cut clean, shows "gap → <section>"
 *      pointing at the offending SectionKind, and leaves the Freeze button disabled.
 *
 * The Freeze button is enabled only when freezeEnabled(model) returns true
 * (i.e. the latest ReadinessRecord has covered && cleanCut both true).
 */
export class ReadinessView implements vscode.Disposable {
  private _panel: vscode.WebviewPanel | undefined;
  private _disposables: vscode.Disposable[] = [];

  /** Reveal or create the readiness panel. */
  show(
    extensionUri: vscode.Uri,
    model: WorkingModel,
    dryRun: DryRunResult | null,
    onFreeze: () => void,
  ): void {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.Two);
      this._panel.webview.html = this._buildHtml(model, dryRun);
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      "thinkubeScratchpadReadiness",
      "Readiness",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      },
    );

    this._panel.webview.html = this._buildHtml(model, dryRun);

    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => {
        if (msg.type === "freeze") {
          onFreeze();
        }
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

  /** Push an updated model and dry-run result into the already-open panel. */
  update(model: WorkingModel, dryRun: DryRunResult | null): void {
    if (this._panel) {
      this._panel.webview.html = this._buildHtml(model, dryRun);
    }
  }

  dispose(): void {
    this._panel?.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }

  private _buildHtml(model: WorkingModel, dryRun: DryRunResult | null): string {
    const uncovered = uncoveredSections(model);
    const canFreeze = freezeEnabled(model);

    // --- Coverage section ---
    const coverageHtml =
      uncovered.length === 0
        ? `<div class="coverage-ok">&#10003; All sections covered</div>`
        : `<div class="coverage-gaps">${uncovered
            .map(
              (k: SectionKind) =>
                `<div class="coverage-red">&#9679; ${this._esc(k)}</div>`,
            )
            .join("\n")}</div>`;

    // --- Dry-run / decomposition section ---
    let dryRunHtml = "";
    if (dryRun) {
      const decompHtml =
        dryRun.decomposition.length > 0
          ? `<ul class="decomposition">${dryRun.decomposition
              .map((item) => `<li>${this._esc(item)}</li>`)
              .join("")}</ul>`
          : `<p class="empty">No decomposition items.</p>`;

      // Gap pointer: shown only when the cut is not clean and a section is named.
      const gapHtml =
        !dryRun.cleanCut && dryRun.gapSection !== null
          ? `<div class="gap-pointer">gap &#8594; <span class="gap-section">${this._esc(dryRun.gapSection)}</span></div>`
          : "";

      dryRunHtml = `
      <section class="dry-run">
        <h2>Decomposition</h2>
        ${decompHtml}
        ${gapHtml}
      </section>`;
    }

    // --- Freeze button ---
    const disabledAttr = canFreeze ? "" : " disabled";
    const freezeTitle = canFreeze
      ? "Freeze and sign the artifact"
      : "Freeze is disabled until coverage is complete and the slice cuts clean";

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Readiness</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
    }
    h1 { font-size: 1.2em; margin: 0 0 16px; }
    h2 { font-size: 1em; margin-bottom: 8px; }
    section { margin-bottom: 16px; }
    .coverage-ok { color: var(--vscode-testing-iconPassed, #4ec9b0); }
    .coverage-gaps { display: flex; flex-direction: column; gap: 4px; }
    .coverage-red { color: var(--vscode-errorForeground); }
    .decomposition { margin: 0 0 8px 16px; padding: 0; }
    .decomposition li { margin-bottom: 4px; }
    .empty { opacity: 0.6; font-style: italic; margin: 0; }
    .gap-pointer {
      color: var(--vscode-errorForeground);
      font-weight: bold;
      margin-top: 8px;
    }
    .gap-section { text-decoration: underline; }
    .freeze-bar {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    button.freeze {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 20px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 1em;
    }
    button.freeze:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }
    button.freeze:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <h1>Readiness</h1>

  <section class="coverage">
    <h2>Coverage</h2>
    ${coverageHtml}
  </section>

  ${dryRunHtml}

  <div class="freeze-bar">
    <button class="freeze"${disabledAttr} title="${this._esc(freezeTitle)}" onclick="requestFreeze()">Freeze</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function requestFreeze() {
      vscode.postMessage({ type: 'freeze' });
    }
  </script>
</body>
</html>`;
  }

  /** Escape HTML special characters. */
  private _esc(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
