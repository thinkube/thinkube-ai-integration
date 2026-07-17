/**
 * itemsTreeCore — pure render/ranking helpers for the native items tree
 * (Phase D, 2026-07-17). No vscode import: fully testable with node:test.
 */

import type { Item, WorkingModel } from "../model";
import { cutReadiness, impactCoverage, journalCoverage } from "../projection";

// ── Pure render helpers (tested) ─────────────────────────────────────────────

/** One-line compact state shown as the TreeItem description. */
export function itemDescription(item: Item): string {
  const parts: string[] = [];
  if (item.evals.complexity !== undefined) parts.push(`C${item.evals.complexity}`);
  if (item.evals.risk !== undefined) parts.push(`R${item.evals.risk}`);
  if (item.modality === "mandatory") parts.push("mandatory");
  if (item.state === "shipped")
    parts.push(`shipped${item.shippedIn ? `:${item.shippedIn}` : ""}`);
  else if (item.state !== "active") parts.push(item.state);
  if ((item.flaggedBy ?? []).length > 0)
    parts.push(`⚑${(item.flaggedBy ?? []).join(",")}`);
  if (item.pendingEdit) parts.push("proposed-edit");
  return parts.join(" · ");
}

/** Markdown tooltip: Why-notes with provenance, evidence, dependency edges. */
export function itemTooltip(item: Item, model: WorkingModel): string {
  const lines: string[] = [item.text, ""];
  for (const note of item.notes) {
    lines.push(`- ${note.by ? `**${note.by}**: ` : ""}${note.text}`);
  }
  if ((item.requires ?? []).length > 0) {
    const byId = new Map<string, string>();
    for (const s of model.sections)
      for (const it of s.items) byId.set(it.id, it.text);
    lines.push("");
    for (const req of item.requires ?? [])
      lines.push(`- requires: ${byId.get(req) ?? req}`);
  }
  for (const ev of item.evidence) {
    lines.push(`- evidence: ${ev.source}`);
  }
  if (item.pendingEdit) {
    lines.push("", `- proposed edit: ${item.pendingEdit.newText}`);
  }
  return lines.join("\n");
}

/** Protected = shipped or flagged (TEP-protected: supersede-only evolution). */
export function isProtectedItem(item: Item): boolean {
  return item.state === "shipped" || (item.flaggedBy ?? []).length > 0;
}

/**
 * Rank unshipped, checked elements by cut proximity: fewest blockers first
 * (reuses the three-dimension per-element readiness).
 */
export function rankElementsForCut(
  model: WorkingModel,
): { id: string; text: string; blockers: number }[] {
  const elements = model.sections
    .filter((s) => s.kind === "elements")
    .flatMap((s) => s.items)
    .filter((it) => it.state === "active" && it.checked);
  if (elements.length === 0) return [];
  const readiness = cutReadiness(
    model,
    elements.map((e) => e.id),
  );
  const blockerCount = new Map(
    readiness.elements.map((e) => [e.elementId, e.blockers.length]),
  );
  return elements
    .map((e) => ({
      id: e.id,
      text: e.text,
      blockers: blockerCount.get(e.id) ?? 0,
    }))
    .sort((a, b) => a.blockers - b.blockers);
}

/** The gate report as a markdown document (reused by the preview command). */
export function renderGateReport(
  model: WorkingModel,
  cutIds?: readonly string[],
): string {
  const elements = model.sections
    .filter((s) => s.kind === "elements")
    .flatMap((s) => s.items)
    .filter((it) => it.state === "active" && it.checked)
    .map((it) => it.id);
  const scope = cutIds && cutIds.length > 0 ? [...cutIds] : elements;
  const ready = cutReadiness(model, scope);
  const impact = impactCoverage(model, cutIds);
  const journal = journalCoverage(model);

  const lines: string[] = ["# Gate report", ""];
  lines.push(
    `**Scope:** ${scope.length} element${scope.length === 1 ? "" : "s"}${
      cutIds && cutIds.length > 0 ? " (cut)" : " (all settled)"
    } · **verdict:** ${ready.pass && impact.pass ? "READY" : "BLOCKED"}`,
    "",
  );
  lines.push("## Convergence, complexity, risk (per element)", "");
  for (const el of ready.elements) {
    lines.push(`### ${el.text}`);
    if (el.blockers.length === 0) {
      lines.push("- ready — criteria and verification linked, evals grounded");
    } else {
      for (const b of el.blockers) lines.push(`- BLOCKER: ${b}`);
    }
    lines.push("");
  }
  if (ready.openGaps.length > 0) {
    lines.push("## Open gaps (block the whole scope)", "");
    for (const g of ready.openGaps) lines.push(`- ${g}`);
    lines.push("");
  }
  lines.push("## Precision (impact coverage)", "");
  if (impact.blockers.length === 0) {
    lines.push(
      `- every commitment traces [serves:] and [delivered-by:]; all ${impact.elements.length} shipping elements referenced`,
    );
  } else {
    for (const b of impact.blockers) lines.push(`- BLOCKER: ${b}`);
  }
  lines.push("", "## Journal coverage", "");
  lines.push(
    journal.remaining.length === 0
      ? `- all ${journal.total} journal entries served`
      : `- entries not yet served: ${journal.remaining.join(", ")} of ${journal.total}`,
  );
  return lines.join("\n");
}

