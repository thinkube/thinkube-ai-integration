import * as fs from "node:fs";
import * as nodePath from "node:path";
import * as vscode from "vscode";
import {
  openScratchpad,
  getScratchpadSession,
  _bootstrapExtensionUri,
} from "./session";
import { emptyModel } from "./model";
import { serialize } from "./persistence";
import { slugify } from "./workers/research";

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
 * Resolve the configured board root (thinkube.thinkingSpace.root).
 * Returns undefined when not configured.
 */
function boardRoot(): string | undefined {
  return (
    vscode.workspace
      .getConfiguration("thinkube.thinkingSpace")
      .get<string>("root")
      ?.trim() || undefined
  );
}

/**
 * Open the chat view with @thinky pre-typed (2026-07-17 field request:
 * "open the chat wired to the thinking space when it is opened"). The wiring
 * itself is inherent — @thinky always talks to the active session singleton —
 * so this only surfaces the mouth. isPartialQuery keeps the mention in the
 * input without submitting. Fail-soft on hosts without the chat view.
 */
import { thinkyDiag } from "./chat/diag";

async function openThinkyChat(namespace?: string, space?: string): Promise<void> {
  const enabled = vscode.workspace
    .getConfiguration("thinkube.thinky")
    .get<boolean>("openChatOnSpaceOpen", true);
  if (!enabled) return;
  // Bidirectional attachment (2026-07-17): prefer opening the space's BOUND
  // Thinky session (resource thinky:/<ns>/<space>); the generic chat view
  // with the @thinky mention is the fallback on hosts where the session
  // editor cannot be opened by resource.
  if (namespace && space) {
    try {
      const uri = vscode.Uri.from({
        scheme: "thinky",
        path: `/${namespace}/${space}`,
      });
      await vscode.commands.executeCommand("vscode.open", uri);
      thinkyDiag(`opened session editor for ${uri.toString()}`);
      return;
    } catch (err) {
      thinkyDiag(
        `vscode.open FAILED for thinky:/${namespace}/${space} — ${err instanceof Error ? err.message : String(err)} — falling back to generic chat`,
      );
    }
  }
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", {
      query: "@thinky ",
      isPartialQuery: true,
    });
  } catch {
    // No chat surface in this host — the board alone is fine.
  }
}

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
      const session = await openScratchpad();
      await openThinkyChat(session.namespace, session.space);
    }),
  );

  // ── Thinking-space tree commands (SP-21/3 SL-6) ──

  /**
   * Open an existing named thinking-space document.
   * Called with (namespace: string, name: string) — the node's two fields.
   * Routes through openScratchpad with namespace, space, and the configured board root.
   * Opening a different (namespace, space) pair replaces the singleton session.
   */
  // Tree commands arrive two ways: the row's default click passes explicit
  // string arguments; an INLINE menu button passes the tree NODE OBJECT as
  // the first argument (field crash 2026-07-17: path.join received an
  // Object). Accept both shapes.
  const nodeString = (v: unknown, key: "namespace" | "name"): string | undefined => {
    if (typeof v === "string") return v;
    if (typeof v === "object" && v !== null) {
      const val = (v as Record<string, unknown>)[key];
      if (typeof val === "string") return val;
    }
    return undefined;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.thinkingSpace.openDoc",
      async (nsArg: unknown, nameArg: unknown) => {
        const namespace = nodeString(nsArg, "namespace");
        const name = nodeString(nameArg, "name") ?? nodeString(nsArg, "name");
        if (!namespace || !name) {
          vscode.window.showErrorMessage(
            "Open thinking space: could not resolve the namespace/name from the tree node.",
          );
          return;
        }
        const sidecarRoot = boardRoot();
        await openScratchpad({ namespace, space: name, sidecarRoot });
        await openThinkyChat(namespace, name);
      },
    ),
  );

  /**
   * Create a new thinking-space document in the given namespace, then open it.
   * Prompts for a name, seeds the part-1 fresh-space shape
   * (emptyModel with one empty-items section per kind), then opens it.
   */
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.thinkingSpace.newDoc",
      async (nsArg: unknown) => {
        const namespace = nodeString(nsArg, "namespace");
        if (!namespace) {
          vscode.window.showErrorMessage(
            "New thinking space: could not resolve the namespace from the tree node.",
          );
          return;
        }
        const sidecarRoot = boardRoot();

        // Prompt for a free-text title (spaces allowed — it is what you see).
        // The on-disk file uses a slug of it; the title is stored in the model.
        const title = await vscode.window.showInputBox({
          prompt: "Name for the new thinking space",
          placeHolder: "e.g. Plugin delivery hardening",
          validateInput: (v) => {
            const t = v.trim();
            if (!t) return "Name cannot be empty";
            if (!slugify(t))
              return "Name must contain at least one letter or digit";
            return undefined;
          },
        });
        if (!title) return; // user cancelled

        const displayTitle = title.trim();
        const baseSlug = slugify(displayTitle);

        // Seed the fresh-space document on disk (if sidecarRoot is set). The
        // filename is the slug; collisions get a numeric suffix so a new title
        // never overwrites an existing space.
        let docName = baseSlug;
        if (sidecarRoot) {
          const thinkingDir = nodePath.join(sidecarRoot, namespace, "thinking");
          try {
            fs.mkdirSync(thinkingDir, { recursive: true });
            let n = 2;
            while (
              fs.existsSync(nodePath.join(thinkingDir, `${docName}.json`))
            ) {
              docName = `${baseSlug}-${n++}`;
            }
            const freshModel = { ...emptyModel("tep"), title: displayTitle };
            fs.writeFileSync(
              nodePath.join(thinkingDir, `${docName}.json`),
              serialize(freshModel),
              "utf8",
            );
          } catch (err) {
            vscode.window.showErrorMessage(
              `Could not create thinking space: ${err instanceof Error ? err.message : String(err)}`,
            );
            return;
          }
        }

        // Open the (possibly just-seeded) document.
        await openScratchpad({ namespace, space: docName, sidecarRoot });
        await openThinkyChat(namespace, docName);
      },
    ),
    // Delete a thinking space and ALL its files — but ONLY while it is still
    // just a draft: once a TEP has been frozen from it (shipped/flagged items),
    // that space is the permanent record and refuses deletion (same guard panic
    // uses). Removes the model, the chat transcript, and the per-space research
    // digests (research/<space>/).
    vscode.commands.registerCommand(
      "thinkube.thinkingSpace.deleteDoc",
      async (nsArg: unknown, nameArg?: unknown) => {
        const namespace = nodeString(nsArg, "namespace");
        const name = nodeString(nameArg, "name") ?? nodeString(nsArg, "name");
        if (!namespace || !name) {
          vscode.window.showErrorMessage(
            "Delete thinking space: could not resolve the space from the tree node.",
          );
          return;
        }
        const sidecarRoot = boardRoot();
        if (!sidecarRoot) return;
        const modelPath = nodePath.join(
          sidecarRoot,
          namespace,
          "thinking",
          `${name}.json`,
        );
        // Guard: refuse once a TEP has been frozen from this space.
        try {
          const model = JSON.parse(fs.readFileSync(modelPath, "utf8")) as {
            sections?: { items?: { state?: string; flaggedBy?: unknown[] }[] }[];
          };
          const frozen = (model.sections ?? []).some((s) =>
            (s.items ?? []).some(
              (it) =>
                it.state === "shipped" ||
                (Array.isArray(it.flaggedBy) && it.flaggedBy.length > 0),
            ),
          );
          if (frozen) {
            vscode.window.showWarningMessage(
              `"${name}" has already produced a frozen TEP — it can't be deleted (shipped items are the record).`,
            );
            return;
          }
        } catch {
          // unreadable/missing model — nothing to protect, allow the delete
        }
        const choice = await vscode.window.showWarningMessage(
          `Delete thinking space "${name}" and all its files — model, chat transcript, and research digests? This cannot be undone.`,
          { modal: true },
          "Delete",
        );
        if (choice !== "Delete") return;
        for (const p of [
          modelPath,
          nodePath.join(sidecarRoot, namespace, "thinking", ".chat", `${name}.jsonl`),
        ]) {
          try {
            fs.rmSync(p, { force: true });
          } catch {
            /* best-effort */
          }
        }
        try {
          fs.rmSync(nodePath.join(sidecarRoot, namespace, "research", name), {
            recursive: true,
            force: true,
          });
        } catch {
          /* best-effort */
        }
        await vscode.commands.executeCommand("thinkube.thinkingSpace.refresh");
        vscode.window.showInformationMessage(`Deleted thinking space "${name}".`);
      },
    ),
  );
}
