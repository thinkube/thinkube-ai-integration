/**
 * REVISION (2026-07-23) — the journal stops being an axiom.
 *
 * Every item is anchored to the journal entry that produced it (servesEntry),
 * which made orphans structurally impossible but also welded the derived space
 * to the exact words written first, when the author knew least. Revision is
 * the way back: change an ask, and the consequences derived from the old
 * wording are void.
 *
 * The rule the author chose, deliberately hard:
 *  - items shipped in a frozen TEP (or protected as another TEP's context)
 *    SURVIVE untouched — a later edit to the words cannot rewrite history;
 *  - every other item of that entry is DELETED, settled or not. If the ask
 *    changed, agreement to its consequences is void until re-given.
 *
 * Drafting is separate from committing: the wording is argued over in the chat
 * at zero cost, dry-run against the space to see what it would break, and only
 * then applied. This module is the pure half — the plan the preview shows is
 * the same plan the commit executes, so they cannot disagree.
 */

import type { WorkingModel } from "./model";
import { findItems, type QueryHit } from "./query";

export interface RevisionPlan {
  entry: number;
  /** The entry's current wording. */
  currentText: string;
  /** roughRequests id, or undefined when the entry is the goal (entry 1). */
  requestId?: string;
  /** Items that will be deleted. */
  purge: QueryHit[];
  /** Shipped/TEP-protected items that survive the revision. */
  preserved: QueryHit[];
  /** Reason this plan cannot be applied, when it cannot. */
  refusal?: string;
}

/** The journal as the rest of the system numbers it: goal = 1. */
export function journalEntries(
  model: WorkingModel,
): { n: number; text: string; requestId?: string }[] {
  const goal = model.sections.find((s) => s.kind === "goal")?.text ?? "";
  return [
    { n: 1, text: goal },
    ...(model.roughRequests ?? []).map((r, i) => ({
      n: i + 2,
      text: r.text,
      requestId: r.id,
    })),
  ];
}

/** What revising this entry would destroy and what it would spare. Pure. */
export function planRevision(model: WorkingModel, entry: number): RevisionPlan {
  const found = journalEntries(model).find((e) => e.n === entry);
  if (!found)
    return {
      entry,
      currentText: "",
      purge: [],
      preserved: [],
      refusal: `there is no journal entry ${entry}`,
    };

  const subtree = findItems(model, { servesEntry: entry, state: "any" });
  const isPreserved = (h: QueryHit): boolean => h.state === "shipped";
  const protectedIds = new Set(
    model.sections
      .flatMap((s) => s.items)
      .filter((it) => (it.flaggedBy ?? []).length > 0)
      .map((it) => it.id),
  );
  return {
    entry,
    currentText: found.text,
    requestId: found.requestId,
    purge: subtree.filter((h) => !isPreserved(h) && !protectedIds.has(h.id)),
    preserved: subtree.filter((h) => isPreserved(h) || protectedIds.has(h.id)),
  };
}

/** The preview a human reads before committing to a revision. */
export function describeRevisionPlan(
  plan: RevisionPlan,
  newText?: string,
): string {
  if (plan.refusal) return `Cannot revise: ${plan.refusal}`;
  const lines: string[] = [
    `Revising journal entry ${plan.entry}:`,
    `  now:  ${plan.currentText}`,
  ];
  if (newText) lines.push(`  to:   ${newText}`);
  const settled = plan.purge.filter((h) => h.settled).length;
  if (plan.purge.length === 0) {
    lines.push("Nothing derived from this entry yet — nothing will be lost.");
  } else {
    lines.push(
      `This DELETES ${plan.purge.length} derived item(s)` +
        `${settled > 0 ? `, ${settled} of which you had settled` : ""}:`,
    );
    const byKind = new Map<string, number>();
    for (const h of plan.purge)
      byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + 1);
    lines.push(
      `  ${[...byKind].map(([k, n]) => `${n} ${k}`).join(", ")}`,
    );
  }
  if (plan.preserved.length > 0) {
    lines.push(
      `${plan.preserved.length} item(s) SURVIVE — shipped in a TEP or protected as one's context:`,
    );
    for (const h of plan.preserved.slice(0, 10))
      lines.push(`  - ${h.id} [${h.kind}] ${h.text.slice(0, 120)}`);
    lines.push(
      "  They cannot be changed by rewording the ask. If the new wording " +
        "conflicts with them, that conflict is reported, not resolved.",
    );
  }
  lines.push("The entry is then re-derived on its own.");
  return lines.join("\n");
}
