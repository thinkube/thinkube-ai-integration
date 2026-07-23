/**
 * The staged expansion pipeline (expansion redesign 2026-07-18).
 *
 * Replaces the single flat gap-filler round with a sequence where each stage
 * feeds the next and DERIVATION RECORDS ITS OWN EDGES:
 *
 *   1. elements   — per journal ENTRY (goal = entry 1), each element carries
 *                   servesEntry (its parking group).
 *   2. constraints — derived from the now-existing elements; each `requires`
 *                    the element(s) it bounds.
 *   3. gap        — the open unknowns per element; each `requires` its element.
 *   4. acceptance — success conditions per element; each `requires` its element.
 *
 * Stages 2–4 are given the live element list (ids + texts) so they can link.
 * The edges they record are what make the cut closure, the orphan check, and
 * the derived risk all work.
 *
 * Prompt builders are pure and exported for tests; the runner uses the same
 * createPhaseWorker/normalize seam as every other round.
 */

import type { Action, WorkingModel } from "../model";
import { anchorElementsFor, buildAdjacency, indexItems } from "../query";
import { renderActionGuide } from "./actionGuide";
import {
  createPhaseWorker,
  GATES,
  renderGroundingBlocks,
  type WorkerFactoryDeps,
  type WorkerRun,
} from "./worker";

export type ExpansionStage = "elements" | "constraints" | "gap" | "acceptance";

export const EXPANSION_STAGES: ExpansionStage[] = [
  "elements",
  "constraints",
  "gap",
  "acceptance",
];

/** The numbered journal (goal = entry 1), as the pipeline sees it. */
export function journalEntries(model: WorkingModel): string[] {
  const goal = model.sections.find((s) => s.kind === "goal")?.text.trim() ?? "";
  return [
    ...(goal ? [goal] : []),
    ...(model.roughRequests ?? []).map((r) => r.text),
  ];
}

/** Live elements (active), id + text, for stages 2–4 to link against. */
export function liveElements(
  model: WorkingModel,
): { id: string; text: string }[] {
  return model.sections
    .filter((s) => s.kind === "elements")
    .flatMap((s) => s.items)
    .filter((it) => it.state === "active")
    .map((it) => ({ id: it.id, text: it.text }));
}

function sectionId(model: WorkingModel, kind: ExpansionStage): string {
  return model.sections.find((s) => s.kind === kind)?.id ?? `<${kind}>`;
}

/**
 * All active item ids belonging to a journal-entry GROUP (parking unit,
 * 2026-07-18): the elements with servesEntry === entry, plus every active
 * non-element item reachable from them through requires edges — UNLESS that
 * item is also reachable from an element in ANOTHER group (shared context is
 * not parked out from under the groups that still need it).
 */
export function groupItemIds(model: WorkingModel, entry: number): string[] {
  const byId = indexItems(model);
  const adj = buildAdjacency(byId);
  const anchorElements = (start: string): string[] =>
    anchorElementsFor(byId, adj, start);

  const entryOf = (elementId: string): number | undefined =>
    byId.get(elementId)?.item.servesEntries?.[0] ??
    byId.get(elementId)?.item.servesEntry;

  const parked = new Set<string>();
  // This group's elements.
  for (const [id, v] of byId.entries())
    if (
      v.kind === "elements" &&
      v.item.state === "active" &&
      (v.item.servesEntries ?? []).includes(entry)
    )
      parked.add(id);
  // Non-element items whose anchor elements are ALL in this group (private).
  for (const [id, v] of byId.entries()) {
    if (v.kind === "elements" || v.kind === "goal") continue;
    if (v.item.state !== "active") continue;
    const anchors = anchorElements(id);
    if (
      anchors.length > 0 &&
      anchors.every((a) => entryOf(a) === entry)
    ) {
      parked.add(id);
    }
  }
  return [...parked];
}
/**
 * Build one stage's prompt. Stage 1 iterates the journal; stages 2–4 iterate
 * the elements. Every prompt names EXACTLY ONE target section so the round
 * stays focused, and (2–4) demands a `requires` edge to an element on every
 * item — the orphan rule enforced at the source.
 */
export function buildStagePrompt(
  stage: ExpansionStage,
  model: WorkingModel,
  contextDigest?: string,
): string {
  const entries = journalEntries(model);
  const grounding = renderGroundingBlocks(model, contextDigest);
  const journalBlock = entries
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");
  const guide = renderActionGuide(
    model,
    GATES.gapFiller.allowedTools,
    "gap-filler",
  );
  const secId = sectionId(model, stage);

  if (stage === "elements") {
    return (
      `You are STAGE 1 of the expansion pipeline: derive the ELEMENTS.\n\n` +
      `Elements are the SUBJECT MATTER — the concrete things the journal commits to BUILDING. ` +
      `They are the root everything else will hang off. Iterate the numbered journal below and, ` +
      `for EACH entry, propose the elements it commits to. Set "servesEntry" to that entry's number ` +
      `(the goal is entry 1) — this is the parking group.\n\n` +
      `Numbered journal (goal = entry 1):\n${journalBlock}` +
      grounding +
      `\n\nRules:\n` +
      `- Propose ONLY into the elements section ("${secId}"). Nothing else this stage.\n` +
      `- One element = one buildable thing. Sharp and few (roughly 2-5 per entry), not a wall.\n` +
      `- Stay at intent altitude — WHAT is built, never HOW (no languages, frameworks, endpoints).\n` +
      `- EVERY element carries "servesEntry" (its journal-entry number) and a "note" ` +
      `(Why / Impact / Modality, one sentence each).\n` +
      `- NEVER restate an existing item in any wording.\n\n` +
      guide
    );
  }

  const els = liveElements(model);
  const elementBlock =
    els.length > 0
      ? els.map((e) => `  - ${e.id}: ${e.text}`).join("\n")
      : "  (none yet — if there are no elements, propose nothing)";

  const stageSpec: Record<
    Exclude<ExpansionStage, "elements">,
    { title: string; what: string }
  > = {
    constraints: {
      title: "STAGE 2 of the expansion pipeline: derive the CONSTRAINTS",
      what:
        `A constraint is something that must HOLD or be respected — a boundary or invariant ` +
        `on one or more elements. Derive constraints FROM the elements above.`,
    },
    gap: {
      title: "STAGE 3 of the expansion pipeline: derive the GAPS",
      what:
        `A gap is a GENUINE unknown that BLOCKS building an element — a real decision not yet made, ` +
        `or a fact not yet known, whose answer would change WHAT gets built. Before raising one, CHECK ` +
        `it against the intent, the CONTEXT DIGEST, and the STANDING ASSUMPTIONS above: if any of them ` +
        `already answers or settles it, it is NOT a gap — do NOT raise it. A question you COULD ask but ` +
        `whose answer is already established (or would not change the build) is not a gap. In ` +
        `particular, never raise a gap a standing assumption resolves — e.g. per-user auth, ` +
        `access-control, or multi-tenant questions on a single-user platform. Few and load-bearing.`,
    },
    acceptance: {
      title: "STAGE 4 of the expansion pipeline: derive the ACCEPTANCE criteria",
      what:
        `An acceptance item states a falsifiable condition that must be TRUE for an element to ` +
        `count as delivered — the definition of done. Derive acceptance FROM the elements. ` +
        `Do not split "what must be true" from "how to check it" — one statement of done per condition.`,
    },
  };
  const spec = stageSpec[stage];

  return (
    `You are ${spec.title}.\n\n${spec.what}\n\n` +
    `The ELEMENTS (the subject matter — link every item you propose to at least one of these):\n` +
    `${elementBlock}\n\n` +
    `Numbered journal for reference (goal = entry 1):\n${journalBlock}` +
    grounding +
    `\n\nRules:\n` +
    `- Propose ONLY into the ${stage} section ("${secId}"). Nothing else this stage.\n` +
    `- Link every item to the element id(s) it derives from via "requires" (from the list above) — ` +
    `the specific one or few it bears on. If you omit it the system attaches the closest element, ` +
    `but a precise link is better.\n` +
    (stage === "gap"
      ? `- OMIT any gap the intent, the context digest, or a standing assumption already answers — ` +
        `do not raise it at all. Only genuine, load-bearing unknowns.\n`
      : "") +
    `- Sharp and few. Do not restate an existing item in any wording.\n` +
    `- EVERY item carries a "note" (Why / Impact / Modality, one sentence each).` +
    (stage === "constraints" || stage === "acceptance"
      ? ` Score "complexity" with its factor and a one-line "complexityRationale" when it is non-trivial.`
      : "") +
    `\n\n` +
    guide
  );
}

// ── Per-ASK derivation (2026-07-18): the interleaved pipeline. For each ask,
//    derive its elements, then its constraints/gap/acceptance scoped to those
//    elements — the orchestrator stamps the requires edge, so orphans are
//    structurally impossible.

export type AskSection = "constraints" | "gap" | "acceptance";

/** Derive ONLY this ask's elements (servesEntry = askNum). */
export function buildAskElementsPrompt(
  askNum: number,
  askText: string,
  model: WorkingModel,
  contextDigest?: string,
): string {
  const grounding = renderGroundingBlocks(model, contextDigest);
  const secId = sectionId(model, "elements");
  const guide = renderActionGuide(
    model,
    GATES.gapFiller.allowedTools,
    "gap-filler",
  );
  return (
    `You are deriving the ELEMENTS for ONE journal ask.\n\n` +
    `THE ASK (#${askNum}):\n${askText}\n\n` +
    `Elements are the SUBJECT MATTER — the concrete BUILDABLE things THIS ask commits to. ` +
    `They are the root everything else hangs off. Set "servesEntry" to ${askNum} on every element.` +
    grounding +
    `\n\nRules:\n` +
    `- Propose ONLY into elements ("${secId}"). One element = one buildable thing. Sharp and few (2-5).\n` +
    `- A REFINEMENT ask (hardening, safeguards, resolving open questions about things that already ` +
    `exist) introduces NO new subject matter — propose ZERO elements and stop; its constraints and ` +
    `gaps will attach to the elements already present. Only add an element for genuinely NEW buildable scope.\n` +
    `- Intent altitude — WHAT is built, never HOW (no languages, frameworks, endpoints).\n` +
    `- EVERY new element carries servesEntry=${askNum} and a "note" (Why / Impact / Modality).\n` +
    `- Never restate an existing item in any wording.\n\n` +
    guide
  );
}

/** Derive one SECTION for THIS ask's elements (edges stamped by the orchestrator). */
export function buildAskSectionPrompt(
  section: AskSection,
  askNum: number,
  askElements: { id: string; text: string }[],
  askText: string,
  model: WorkingModel,
  contextDigest?: string,
  isRefinement = false,
): string {
  const grounding = renderGroundingBlocks(model, contextDigest);
  const secId = sectionId(model, section);
  const guide = renderActionGuide(
    model,
    GATES.gapFiller.allowedTools,
    "gap-filler",
  );
  const elBlock = askElements.map((e) => `  - ${e.id}: ${e.text}`).join("\n");
  const what: Record<AskSection, string> = {
    constraints: "boundaries / invariants that must HOLD on these elements",
    gap:
      "GENUINE unknowns that BLOCK specifying or building these elements — a real " +
      "unmade decision or a missing fact the work waits on. A question you COULD ask " +
      "but whose answer would not change what gets built is NOT a gap. Few and load-bearing.",
    acceptance:
      "falsifiable conditions that must be TRUE for these elements to count as delivered",
  };
  // A refinement ask does not re-derive the whole space — it adds only the few
  // NEW items it introduces, attached to the specific existing elements it names.
  const scope = isRefinement
    ? `This ask REFINES elements that already exist — it introduces NO new subject matter. Add ONLY ` +
      `the few NEW ${section} items THIS ask itself introduces, each attached to the SPECIFIC element(s) ` +
      `it concerns. The space already lists its current ${section} items below — do NOT re-derive them ` +
      `across the whole element set; if this ask adds nothing to ${section}, propose nothing.`
    : `${section} = ${what[section]}, derived FROM these elements.`;
  return (
    `You are deriving the ${section.toUpperCase()} for ONE journal ask (#${askNum}: ${askText}).\n\n` +
    `Its ELEMENTS (link each item you propose to the element id(s) it serves):\n${elBlock}\n\n` +
    scope +
    grounding +
    `\n\nRules:\n` +
    `- Propose ONLY into ${section} ("${secId}"). Sharp and FEW — prefer the smallest set that is load-bearing.\n` +
    `- Put the SPECIFIC element id(s) this item concerns in "requires" (from the list above) — ` +
    `the one or few it actually bears on, not all of them. If you omit it, the system links the ` +
    `item to this ask's elements automatically.\n` +
    `- Never restate or duplicate an existing item (the space state below lists them). ` +
    `EVERY item carries a "note" (Why / Impact / Modality).\n\n` +
    guide
  );
}

/** Worker for a per-ask element round. */
export function askElementsWorker(
  askNum: number,
  askText: string,
  deps: WorkerFactoryDeps,
): WorkerRun {
  const base = createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.gapFiller.allowedTools,
    disallowedTools: GATES.gapFiller.disallowedTools,
    actor: "gap-filler",
  });
  return {
    ...base,
    buildPrompt(model: WorkingModel): string {
      return buildAskElementsPrompt(askNum, askText, model, deps.contextDigest);
    },
    async run(model: WorkingModel, conversation: string[]): Promise<Action[]> {
      return base.run(model, conversation);
    },
  };
}

/** Worker for a per-ask section round. `isRefinement` = this ask reuses
 *  existing elements (added no new subject matter) — derive only what it adds. */
export function askSectionWorker(
  section: AskSection,
  askNum: number,
  askElements: { id: string; text: string }[],
  askText: string,
  deps: WorkerFactoryDeps,
  isRefinement = false,
): WorkerRun {
  const base = createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.gapFiller.allowedTools,
    disallowedTools: GATES.gapFiller.disallowedTools,
    actor: "gap-filler",
  });
  return {
    ...base,
    buildPrompt(model: WorkingModel): string {
      return buildAskSectionPrompt(
        section,
        askNum,
        askElements,
        askText,
        model,
        deps.contextDigest,
        isRefinement,
      );
    },
    async run(model: WorkingModel, conversation: string[]): Promise<Action[]> {
      return base.run(model, conversation);
    },
  };
}

/**
 * Stamp the requires-edge on section actions (orphan-proofing 2026-07-18):
 * any proposeItem into a per-ask section that does not already require one of
 * the ask's elements gets ALL of them added — so the orchestrator, which KNOWS
 * the ask's elements, guarantees the link the worker might have omitted.
 */
export function stampAskEdges(
  actions: Action[],
  askElementIds: string[],
): Action[] {
  if (askElementIds.length === 0) return actions;
  const elSet = new Set(askElementIds);
  return actions.map((a) => {
    if (a.type !== "proposeItem") return a;
    const req = a.item.requires ?? [];
    if (req.some((id) => elSet.has(id))) return a;
    return { ...a, item: { ...a.item, requires: [...req, ...askElementIds] } };
  });
}

/** Lowercased word tokens, for best-element matching. */
function wordTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/**
 * Anchor every section proposeItem to the ask that owns it (2026-07-18 global
 * passes): stamp `servesEntry` — the primary structural anchor — deriving it
 * from the element the item requires. If the worker omitted the element edge,
 * attach the best-matching element (token overlap) so the item still has both
 * an edge (risk/cut precision) and a servesEntry (the anchor). With every item
 * tagged this way, orphans are impossible by construction — no per-ask
 * interleaving needed. Elements are passed with their own servesEntry.
 */
export function stampServesEntry(
  actions: Action[],
  elements: { id: string; text: string; serves: number }[],
): Action[] {
  if (elements.length === 0) return actions;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const elTokens = elements.map((e) => ({ e, toks: wordTokens(e.text) }));
  const bestElement = (text: string): { id: string; serves: number } => {
    const ot = wordTokens(text);
    let best = elTokens[0].e;
    let bestScore = -1;
    for (const { e, toks } of elTokens) {
      let s = 0;
      for (const t of ot) if (toks.has(t)) s++;
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    return best;
  };
  return actions.map((a) => {
    if (a.type !== "proposeItem") return a;
    const req = a.item.requires ?? [];
    const linked = req.map((id) => byId.get(id)).filter(Boolean) as {
      id: string;
      serves: number;
    }[];
    if (linked.length > 0) {
      const serves = a.item.servesEntries?.[0] ?? linked[0].serves;
      return { ...a, item: { ...a.item, servesEntries: [serves] } };
    }
    // No element edge — attach the best-matching element and inherit its ask.
    const best = bestElement(a.item.text);
    const serves = a.item.servesEntries?.[0] ?? best.serves;
    return {
      ...a,
      item: { ...a.item, requires: [...req, best.id], servesEntries: [serves] },
    };
  });
}

/**
 * A pipeline-stage worker: the gap-filler gate, but its prompt is the
 * stage-specific derivation (buildStagePrompt). One target section per stage.
 */
export function expansionStageWorker(
  stage: ExpansionStage,
  deps: WorkerFactoryDeps,
): WorkerRun {
  const base = createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.gapFiller.allowedTools,
    disallowedTools: GATES.gapFiller.disallowedTools,
    actor: "gap-filler",
  });
  return {
    ...base,
    buildPrompt(model: WorkingModel, _conversation: string[]): string {
      return buildStagePrompt(stage, model, deps.contextDigest);
    },
    async run(model: WorkingModel, conversation: string[]): Promise<Action[]> {
      return base.run(model, conversation);
    },
  };
}

/**
 * Build the ORPHAN-REPAIR prompt (self-repair 2026-07-18): given the orphans
 * the integrity gate found and the live elements, the worker either links an
 * orphan to the element it serves (linkItems) or promotes a mislabeled orphan
 * into elements (reclassifyItem). It never drops — genuine noise stays flagged
 * for the human.
 */
export function buildRepairPrompt(
  model: WorkingModel,
  orphans: { id: string; kind: string; text: string }[],
): string {
  const els = liveElements(model);
  const elementBlock =
    els.length > 0
      ? els.map((e) => `  - ${e.id}: ${e.text}`).join("\n")
      : "  (no elements)";
  const orphanBlock = orphans
    .map((o) => `  - ${o.id} [${o.kind}]: ${o.text}`)
    .join("\n");
  const guide = renderActionGuide(model, GATES.repair.allowedTools, "integrator");
  return (
    `You are the ORPHAN-REPAIR round. Each orphan below is tied to NO element — ` +
    `the pipeline's own mistake. Heal each one:\n\n` +
    `ELEMENTS:\n${elementBlock}\n\nORPHANS:\n${orphanBlock}\n\n` +
    `For EACH orphan, choose exactly one:\n` +
    `- If it genuinely serves one of the elements above (it is a real constraint / gap / ` +
    `acceptance about that element), emit linkItems adding the requires edge to that element id.\n` +
    `- If the orphan is ITSELF a buildable thing (an element mislabeled — e.g. a deliverable ` +
    `sitting in constraints), emit reclassifyItem moving it to "elements" with servesEntry set ` +
    `to the journal entry it belongs to.\n` +
    `Do NOT invent elements or drop anything. If an orphan fits neither, leave it (the human decides).\n\n` +
    guide
  );
}

export function repairWorker(deps: WorkerFactoryDeps & { orphans: { id: string; kind: string; text: string }[] }): WorkerRun {
  const base = createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.repair.allowedTools,
    disallowedTools: GATES.repair.disallowedTools,
    actor: "integrator",
  });
  return {
    ...base,
    buildPrompt(model: WorkingModel): string {
      return buildRepairPrompt(model, deps.orphans);
    },
    async run(model: WorkingModel, conversation: string[]): Promise<Action[]> {
      return base.run(model, conversation);
    },
  };
}
