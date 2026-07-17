/**
 * Native items tree (Phase D, 2026-07-17) — retires the webview row-farm.
 *
 * A checkbox TreeView over the live thinking-space model: sections → items,
 * native checkbox = the settling act (toggleItem), context-menu verbs speak
 * the SAME inbound messages the webview panel does (postFromWebview is the
 * one seam). The webview panel stays available and feature-frozen — this is
 * the primary settling surface going forward.
 *
 * Pure/renderable parts (labels, descriptions, tooltips, cut ranking) are
 * exported for tests; the vscode.TreeDataProvider wiring is thin.
 */

import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import * as vscode from "vscode";
import { getScratchpadSession } from "../session";
import type { ScratchpadSession } from "../session";
import type { Item, Section } from "../model";
import { showFreshMarkdownPreview } from "../../commands/freshPreview";
import {
  isProtectedItem,
  itemDescription,
  itemTooltip,
  rankElementsForCut,
  renderGateReport,
} from "./itemsTreeCore";

// ── Tree provider ────────────────────────────────────────────────────────────

type TreeNode =
  | { kind: "section"; section: Section }
  | { kind: "item"; item: Item; section: Section };

const VIEW_ID = "tandemThinkingItems";

class ThinkingItemsProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _subscribed: ScratchpadSession | undefined;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  private _session(): ScratchpadSession | undefined {
    const session = getScratchpadSession();
    if (session && session !== this._subscribed) {
      this._subscribed = session;
      session.onDidChange(() => this._onDidChangeTreeData.fire());
    }
    return session;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    const session = this._session();
    if (!session) return [];
    const model = session.model;
    if (!element) {
      return model.sections
        .filter((s) => s.kind !== "goal")
        .map((section) => ({ kind: "section" as const, section }));
    }
    if (element.kind === "section") {
      return element.section.items
        .filter((it) => it.state !== "dropped")
        .map((item) => ({
          kind: "item" as const,
          item,
          section: element.section,
        }));
    }
    return [];
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "section") {
      const visible = node.section.items.filter((it) => it.state !== "dropped");
      const settled = visible.filter(
        (it) => it.checked && it.state === "active",
      ).length;
      const treeItem = new vscode.TreeItem(
        node.section.kind,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      treeItem.id = `section-${node.section.id}`;
      treeItem.description = visible.length > 0 ? `${settled}/${visible.length}` : "";
      treeItem.contextValue = "tandemSection";
      return treeItem;
    }
    const session = this._session();
    const { item } = node;
    const treeItem = new vscode.TreeItem(
      item.text,
      vscode.TreeItemCollapsibleState.None,
    );
    treeItem.id = item.id;
    treeItem.description = itemDescription(item);
    if (session) {
      treeItem.tooltip = new vscode.MarkdownString(
        itemTooltip(item, session.model),
      );
    }
    if (item.state === "active") {
      treeItem.checkboxState = item.checked
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
    }
    treeItem.contextValue = isProtectedItem(item)
      ? "tandemItemProtected"
      : "tandemItem";
    return treeItem;
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

/** Rendered (not raw-editor) preview via a scratch file, spec-approval style. */
async function previewMarkdown(content: string, name: string): Promise<void> {
  const dir = nodePath.join(nodeOs.tmpdir(), "tandem-previews");
  await nodeFs.mkdir(dir, { recursive: true });
  const file = nodePath.join(dir, name);
  await nodeFs.writeFile(file, content, "utf8");
  await showFreshMarkdownPreview(vscode.Uri.file(file));
}

async function withSession(
  fn: (session: ScratchpadSession) => Promise<void>,
): Promise<void> {
  const session = getScratchpadSession();
  if (!session) {
    vscode.window.showInformationMessage(
      "Open a thinking space first (ThinkingSpaces view).",
    );
    return;
  }
  await fn(session);
}

function nodeItemId(node: unknown): string | undefined {
  if (typeof node === "object" && node !== null && "item" in node) {
    const item = (node as { item: { id?: unknown } }).item;
    if (typeof item?.id === "string") return item.id;
  }
  return undefined;
}

export function registerItemsTree(context: vscode.ExtensionContext): void {
  const provider = new ThinkingItemsProvider();
  const view = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(view);

  // Native checkbox IS the settling act.
  context.subscriptions.push(
    view.onDidChangeCheckboxState(async (e) => {
      await withSession(async (session) => {
        for (const [node, state] of e.items) {
          const itemId = nodeItemId(node);
          if (!itemId) continue;
          await session.postFromWebview({
            type: "toggleItem",
            itemId,
            checked: state === vscode.TreeItemCheckboxState.Checked,
          });
        }
      });
    }),
  );

  const itemCommand = (
    name: string,
    handler: (session: ScratchpadSession, itemId: string) => Promise<void>,
  ): vscode.Disposable =>
    vscode.commands.registerCommand(name, async (node: unknown) => {
      const itemId = nodeItemId(node);
      if (!itemId) return;
      await withSession((session) => handler(session, itemId));
    });

  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.items.refresh", () =>
      provider.refresh(),
    ),
    itemCommand("thinkube.items.why", (session, itemId) =>
      session.postFromWebview({ type: "explainItem", itemId }),
    ),
    itemCommand("thinkube.items.research", async (session, itemId) => {
      const subject = await vscode.window.showInputBox({
        prompt: "Research what? (directs the round)",
        placeHolder: "e.g. how the existing digest store persists artifacts",
      });
      if (subject === undefined) return;
      await session.postFromWebview({
        type: "research",
        itemId,
        subject: subject.trim() || undefined,
      });
    }),
    itemCommand("thinkube.items.resolve", (session, itemId) =>
      session.postFromWebview({ type: "resolveItem", itemId }),
    ),
    itemCommand("thinkube.items.defer", (session, itemId) =>
      session.postFromWebview({ type: "deferItem", itemId }),
    ),
    itemCommand("thinkube.items.drop", async (session, itemId) => {
      const choice = await vscode.window.showWarningMessage(
        "Drop this item? A drop is a permanent veto — workers may never re-propose it in any wording.",
        { modal: true },
        "Drop",
      );
      if (choice !== "Drop") return;
      await session.postFromWebview({ type: "dropItem", itemId });
    }),
    itemCommand("thinkube.items.acceptEval", async (session, itemId) => {
      const facet = await vscode.window.showQuickPick(
        [
          { label: "complexity", description: "accept residual complexity" },
          { label: "risk", description: "accept residual risk" },
        ],
        { placeHolder: "Accept which residual? (prints into the TEP, signed)" },
      );
      if (!facet) return;
      const reason = await vscode.window.showInputBox({
        prompt: `Why is this ${facet.label} acceptable? (your signed reason)`,
      });
      if (!reason?.trim()) return;
      await session.postFromWebview({
        type: "acceptEval",
        itemId,
        facet: facet.label as "complexity" | "risk",
        reason: reason.trim(),
      });
    }),
    itemCommand("thinkube.items.toggleCut", (session, itemId) =>
      session.postFromWebview({ type: "toggleCut", itemId }),
    ),
    itemCommand("thinkube.items.stage", (session, itemId) =>
      session.postFromWebview({ type: "toggleSelect", itemId }),
    ),
  );

  // Cut flow: ranked multi-select of settled elements → cut → gate report.
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.items.cutFlow", () =>
      withSession(async (session) => {
        const ranked = rankElementsForCut(session.model);
        if (ranked.length === 0) {
          vscode.window.showInformationMessage(
            "No settled elements yet — check elements before cutting a TEP.",
          );
          return;
        }
        const picked = await vscode.window.showQuickPick(
          ranked.map((e) => ({
            label: e.text,
            description:
              e.blockers === 0
                ? "ready"
                : `${e.blockers} blocker${e.blockers === 1 ? "" : "s"}`,
            id: e.id,
          })),
          {
            canPickMany: true,
            placeHolder:
              "Elements for this cut (ranked: fewest blockers first)",
          },
        );
        if (!picked || picked.length === 0) return;
        await session.postFromWebview({ type: "clearCut" });
        for (const p of picked) {
          await session.postFromWebview({ type: "toggleCut", itemId: p.id });
        }
        await previewMarkdown(
          renderGateReport(
            session.model,
            picked.map((p) => p.id),
          ),
          "gate-report.md",
        );
      }),
    ),
    vscode.commands.registerCommand("thinkube.items.gateReport", () =>
      withSession(async (session) => {
        await previewMarkdown(renderGateReport(session.model), "gate-report.md");
      }),
    ),
  );
}
