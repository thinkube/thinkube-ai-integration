/**
 * The QUERY ENGINE — one way to ask "which items?".
 *
 * Selection by criteria, inspection, and the revision preview all need the same
 * answer to the same question, so they share one implementation. The agent
 * translates the human's phrasing ("all the constraints related to the first
 * element") into a query; this resolves it EXACTLY against the model. The
 * division is deliberate: wording is the model's job, resolution is code's —
 * an agent that inferred relationships itself would confidently act on edges
 * that do not exist.
 *
 * Criteria combine with AND. `state` defaults to "active" because every caller
 * so far means live items; pass it explicitly to reach shipped/deferred ones.
 */

import type { Item, ItemState, SectionKind, WorkingModel } from "./model";
import { computeElementRisk } from "./deriveRisk";
import { computeIntegrity } from "./integrityGate";

export interface ItemQuery {
  /** Section the item lives in. */
  kind?: SectionKind;
  /**
   * Relational: items that belong to the same element(s) as this item.
   * An element id matches the element itself plus everything anchored to it;
   * any other id matches items sharing at least one of its anchor elements.
   */
  relatedTo?: string;
  /** Journal entry the item was derived from (goal = 1). */
  servesEntry?: number;
  /** Settled (checked) or not. */
  settled?: boolean;
  /** Lifecycle state. Defaults to "active"; pass "any" for all. */
  state?: ItemState | "any";
  riskAtLeast?: number;
  complexityAtLeast?: number;
  /** Gaps carrying a machine recommendation awaiting ratification. */
  hasDecisionPending?: boolean;
  /** Case-insensitive substring of the item text. */
  textMatches?: string;
  /** Structurally orphaned items (integrity gate's definition). */
  orphans?: boolean;
  /** Items protected by a frozen TEP (flaggedBy) — or, negated, unprotected. */
  isProtected?: boolean;
}

export interface QueryHit {
  id: string;
  kind: SectionKind;
  text: string;
  settled: boolean;
  state: ItemState;
  servesEntry?: number;
  risk?: number;
  complexity?: number;
}

interface Indexed {
  kind: SectionKind;
  item: Item;
}

/** id → {section kind, item}, for the whole model. */
export function indexItems(model: WorkingModel): Map<string, Indexed> {
  const byId = new Map<string, Indexed>();
  for (const s of model.sections)
    for (const it of s.items) byId.set(it.id, { kind: s.kind, item: it });
  return byId;
}

/** Undirected adjacency over `requires` edges that resolve to a real item. */
export function buildAdjacency(
  byId: Map<string, Indexed>,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const { item } of byId.values())
    for (const req of item.requires ?? [])
      if (byId.has(req)) link(item.id, req);
  return adj;
}

/**
 * The elements an item anchors to: reachable through `requires` edges WITHOUT
 * traversing another element. Elements are sinks — otherwise everything is
 * transitively connected through shared elements and nothing is ever private.
 * This is the same rule parking uses to decide what belongs to a group.
 */
export function anchorElementsFor(
  byId: Map<string, Indexed>,
  adj: Map<string, Set<string>>,
  start: string,
): string[] {
  if (byId.get(start)?.kind === "elements") return [start];
  const anchors = new Set<string>();
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const cur = q.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      if (byId.get(nb)?.kind === "elements") anchors.add(nb);
      else q.push(nb);
    }
  }
  return [...anchors];
}

/** An item's risk: derived from open gaps for elements, stored otherwise. */
function riskOf(model: WorkingModel, kind: SectionKind, item: Item): number | undefined {
  if (kind === "elements" && item.state === "active")
    return computeElementRisk(model, item.id).score;
  return item.evals.risk;
}

/** Resolve a query against the model. Pure. */
export function findItems(model: WorkingModel, q: ItemQuery): QueryHit[] {
  const byId = indexItems(model);
  const adj = buildAdjacency(byId);

  // Relational pre-pass: the anchor set the query is asking about.
  let wantedAnchors: Set<string> | undefined;
  if (q.relatedTo !== undefined) {
    if (!byId.has(q.relatedTo)) return [];
    wantedAnchors = new Set(anchorElementsFor(byId, adj, q.relatedTo));
  }

  const orphanIds =
    q.orphans === undefined
      ? undefined
      : new Set(computeIntegrity(model).orphans.map((o) => o.id));

  const needle = q.textMatches?.trim().toLowerCase();
  const hits: QueryHit[] = [];

  for (const [id, { kind, item }] of byId) {
    if (kind === "goal") continue;
    const state = q.state ?? "active";
    if (state !== "any" && item.state !== state) continue;
    if (q.kind !== undefined && kind !== q.kind) continue;
    if (q.servesEntry !== undefined && item.servesEntry !== q.servesEntry)
      continue;
    if (q.settled !== undefined && item.checked !== q.settled) continue;
    if (q.hasDecisionPending !== undefined &&
        Boolean(item.decisionProposal) !== q.hasDecisionPending)
      continue;
    if (q.isProtected !== undefined &&
        (item.flaggedBy ?? []).length > 0 !== q.isProtected)
      continue;
    if (needle && !item.text.toLowerCase().includes(needle)) continue;
    if (orphanIds !== undefined && orphanIds.has(id) !== q.orphans) continue;

    const risk = riskOf(model, kind, item);
    if (q.riskAtLeast !== undefined && (risk ?? 0) < q.riskAtLeast) continue;
    const complexity = item.evals.complexity;
    if (q.complexityAtLeast !== undefined &&
        (complexity ?? 0) < q.complexityAtLeast)
      continue;

    if (wantedAnchors !== undefined) {
      // The queried item itself always belongs to its own relation.
      if (id !== q.relatedTo) {
        const anchors = anchorElementsFor(byId, adj, id);
        if (!anchors.some((a) => wantedAnchors!.has(a))) continue;
      }
    }

    hits.push({
      id,
      kind,
      text: item.text,
      settled: item.checked,
      state: item.state,
      servesEntry: item.servesEntry,
      risk,
      complexity,
    });
  }
  return hits;
}

/** One-line-per-hit rendering, for echoing a selection back before acting. */
export function renderHits(hits: readonly QueryHit[], limit = 40): string {
  if (hits.length === 0) return "(no items match)";
  const shown = hits.slice(0, limit);
  const lines = shown.map((h) => {
    const marks = [
      h.settled ? "✓settled" : undefined,
      h.state !== "active" ? h.state : undefined,
      h.servesEntry !== undefined ? `entry${h.servesEntry}` : undefined,
      h.risk !== undefined ? `R${h.risk}` : undefined,
    ].filter(Boolean);
    return `  - ${h.id} [${h.kind}${marks.length ? `,${marks.join(",")}` : ""}] ${h.text.slice(0, 160)}`;
  });
  if (hits.length > shown.length)
    lines.push(`  … and ${hits.length - shown.length} more`);
  return lines.join("\n");
}
