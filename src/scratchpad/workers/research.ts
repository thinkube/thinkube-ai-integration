// src/scratchpad/workers/research.ts — research worker (SP-21/3 SL-3)
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import type { Action, WorkingModel } from "../model";
import { GATES } from "./worker";
import type { QueryFn, QueryOptions, WorkerRun } from "./worker";
import { normalizeWorkerActions, renderActionGuide } from "./actionGuide";

// ===== Exported types =====

/**
 * Persistent store for research dossiers.
 * Default is rooted at <sidecarRoot>/<namespace>/research/ (SL-3 wires it).
 * Re-exported from session.ts so consumers may import from either location.
 */
export interface DossierStore {
  read(topic: string): Promise<string | undefined>;
  write(topic: string, markdown: string): Promise<{ dossierRef: string }>;
}

export interface ResearchTarget {
  itemId?: string;
  subject?: string;
}

/**
 * Dependencies for the research worker factory.
 * deps = { loadQuery, dossier, now } per the SP-21/3 contract, plus
 * sidecarRoot and namespace to derive the corpusPaths value.
 */
export interface ResearchDeps {
  loadQuery: () => QueryFn;
  dossier: DossierStore;
  now: () => Date;
  /** Board root — used to derive corpusPaths: [<sidecarRoot>/<namespace>]. */
  sidecarRoot?: string;
  /** Namespace within sidecarRoot — defaults to "default". */
  namespace?: string;
}

// ===== Internal helpers =====

/**
 * Derive a stable topic slug from text.
 * Lowercase, spaces→"-", strip any character that is not [a-z0-9-],
 * collapse consecutive hyphens, strip leading/trailing hyphens.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Find the text of an item by id across all sections in the model.
 */
function findItemText(model: WorkingModel, itemId: string): string | undefined {
  for (const section of model.sections) {
    for (const item of section.items) {
      if (item.id === itemId) {
        return item.text;
      }
    }
  }
  return undefined;
}

/**
 * Collect the set of item IDs currently in the model.
 */
function collectItemIds(model: WorkingModel): Set<string> {
  const ids = new Set<string>();
  for (const section of model.sections) {
    for (const item of section.items) {
      ids.add(item.id);
    }
  }
  return ids;
}

/**
 * Build the research prompt, including verbatim dossier content when present.
 */
function buildResearchPrompt(
  model: WorkingModel,
  subjectText: string,
  topic: string,
  mcpTools: string[],
  corpusPath: string | undefined,
  existingDossier: string | undefined,
): string {
  // Dossier included VERBATIM when present (contract: "that markdown is included
  // VERBATIM in the round's prompt").
  const dossierBlock = existingDossier
    ? `\n\n## Existing Dossier (research/${topic}.md)\n\n${existingDossier}`
    : "";

  // Collect all items with their evidence dossierRefs for context.
  const itemLines: string[] = [];
  for (const section of model.sections) {
    if (section.kind === "goal") continue;
    for (const item of section.items) {
      const refs = item.evidence
        .filter((ev) => ev.dossierRef !== undefined)
        .map((ev) => ev.dossierRef as string);
      const refsStr = refs.length > 0 ? ` [dossier: ${refs.join(", ")}]` : "";
      itemLines.push(`  [${section.kind}] ${item.text}${refsStr}`);
    }
  }
  const itemsBlock =
    itemLines.length > 0 ? `\n\nExisting items:\n${itemLines.join("\n")}` : "";

  const goalSection = model.sections.find((s) => s.kind === "goal");
  const intentText = goalSection?.text ?? "";

  return (
    `You are the research worker. Investigate the topic: "${subjectText}"\n\n` +
    `Topic slug: ${topic}\n\n` +
    `Intent (goal):\n${intentText}` +
    itemsBlock +
    dossierBlock +
    `\n\n` +
    `Research instructions:\n` +
    `- Use the available tools (${mcpTools.join(", ")}) to gather live, grounded information.\n` +
    `- Do NOT answer from training data alone — use the tools to verify facts.\n` +
    `- Propose findings as unchecked items (proposeItem) with appropriate modality.\n` +
    `- Attach evidence chips (attachEvidence) to items you find — include source, method, and a dossierRef of "research/${topic}.md".\n` +
    `- You may add notes (addItemNote) to existing items to annotate them with research findings.\n` +
    `- NEVER check items — only propose them as unchecked (checked:false).\n` +
    `- NEVER write files directly — all dossier output goes through the sanctioned dossier writer.\n` +
    (corpusPath
      ? `- Corpus scope: ${corpusPath} — consult TEPs, retros, and defects there for context.\n`
      : "") +
    `\n${renderActionGuide(model, GATES.research.allowedTools, "research")}`
  );
}

// ===== research() factory =====

/**
 * Research worker factory.
 *
 * research(deps, target) — returns a WorkerRun gated at GATES.research:
 *   allowed:    [proposeItem, attachEvidence, addItemNote]
 *   disallowed: [checkItem, uncheckItem, addItem, freeze, editGoal, resolveEdit, proposeEdit]
 *
 * Dossier-first: run() calls dossier.read(topic) BEFORE any query round; when
 * it returns markdown, that markdown is included VERBATIM in the prompt.
 *
 * Topic derivation: slugify(target.subject ?? <the item's text>)
 *
 * QueryOptions carry EXACTLY:
 *   mcpTools:    ["tk-package-version", "web-fetch", "repo-explorer"]
 *   corpusPaths: [<sidecarRoot>/<namespace>]
 *
 * The worker's only write surface is DossierStore (never writes files directly).
 * Every evidence chip the round attaches:
 *   { source, method, checkedAt: deps.now().toISOString(), dossierRef }
 * where dossierRef points at the file the same round wrote (or re-read).
 */
export function research(
  deps: ResearchDeps,
  target: ResearchTarget,
): WorkerRun {
  const mcpTools = ["tk-package-version", "web-fetch", "repo-explorer"];

  // Derive corpusPaths — the board corpus: TEPs, retros, defects.
  // EXACTLY [<sidecarRoot>/<namespace>] per the contract.
  const corpusPaths: string[] = [];
  let corpusPath: string | undefined;
  if (deps.sidecarRoot) {
    const ns = deps.namespace ?? "default";
    corpusPath = nodePath.join(deps.sidecarRoot, ns);
    corpusPaths.push(corpusPath);
  }

  return {
    buildOptions(): QueryOptions {
      const opts: QueryOptions = {
        model: "sonnet",
        allowedTools: GATES.research.allowedTools,
        disallowedTools: GATES.research.disallowedTools,
        mcpTools,
      };
      if (corpusPaths.length > 0) {
        opts.corpusPaths = corpusPaths;
      }
      return opts;
    },

    // The WorkerRun interface defines buildPrompt with exactly two params.
    // The dossier content is woven into run() — buildPrompt provides a
    // no-dossier prompt for interface compatibility (used by tests that call
    // buildPrompt directly without a dossier).
    buildPrompt(model: WorkingModel, _conversation: string[]): string {
      let subjectText: string;
      if (target.subject) {
        subjectText = target.subject;
      } else if (target.itemId) {
        subjectText = findItemText(model, target.itemId) ?? target.itemId;
      } else {
        subjectText = "general";
      }
      const topic = slugify(subjectText);
      return buildResearchPrompt(
        model,
        subjectText,
        topic,
        mcpTools,
        corpusPath,
        undefined, // no existing dossier available at buildPrompt-call time
      );
    },

    async run(model: WorkingModel, _conversation: string[]): Promise<Action[]> {
      // ── Derive topic slug ──────────────────────────────────────────────────
      let subjectText: string;
      if (target.subject) {
        subjectText = target.subject;
      } else if (target.itemId) {
        subjectText = findItemText(model, target.itemId) ?? target.itemId;
      } else {
        subjectText = "general";
      }
      const topic = slugify(subjectText);

      // ── DOSSIER-FIRST: read before any model round ─────────────────────────
      const existingDossier = await deps.dossier.read(topic);

      // ── Build options and prompt ───────────────────────────────────────────
      const options = this.buildOptions();
      const prompt = buildResearchPrompt(
        model,
        subjectText,
        topic,
        mcpTools,
        corpusPath,
        existingDossier,
      );

      // ── Run the query round ────────────────────────────────────────────────
      const queryFn = deps.loadQuery();
      const parsedActions: Action[] = [];
      for await (const msg of queryFn({ prompt, options })) {
        if (msg.type === "actions") {
          parsedActions.push(...msg.actions);
        }
      }

      // ── Validation seam: coerce/verify BEFORE the assembly pipeline ───────
      // Malformed shapes (e.g. "tool" instead of "type", section names instead
      // of sectionIds) are salvaged or rejected here — nothing off-contract
      // reaches the reducer's throw sites.
      const { valid: rawActions, rejected } = normalizeWorkerActions(
        parsedActions as unknown[],
        model,
        {
          defaultActor: "research",
          allowedTools: GATES.research.allowedTools,
          nowIso: deps.now().toISOString(),
        },
      );
      if (rejected.length > 0) {
        console.error(
          `[research.run] rejected ${rejected.length} malformed/out-of-gate action(s): ` +
            rejected.map((r) => r.reason).join("; "),
        );
      }

      // ── Write the dossier (always — marks the round happened) ─────────────
      const proposedItems = rawActions
        .filter((a) => a.type === "proposeItem")
        .map((a) => (a.type === "proposeItem" ? `- ${a.item.text}` : ""))
        .filter(Boolean);

      const dossierContent = buildDossierContent(
        subjectText,
        topic,
        existingDossier,
        proposedItems,
        deps.now(),
      );
      let dossierRef: string;
      try {
        const writeResult = await deps.dossier.write(topic, dossierContent);
        dossierRef = writeResult.dossierRef;
      } catch (writeErr) {
        dossierRef = `research/${topic}.md`;
        console.error(
          `[research.run] dossier.write FAILED: ${writeErr}; using fallback dossierRef=${JSON.stringify(dossierRef)}`,
        );
      }

      // ── Evidence stamp values ──────────────────────────────────────────────
      const checkedAt = deps.now().toISOString();

      // ── Build reachable item ID set (existing + predicted from proposeItem) ─
      // Used to guard actions targeting items: if an action names an item that
      // neither exists now nor will be created by a preceding proposeItem, the
      // reducer would THROW (not reject gracefully), aborting the whole dispatch
      // loop before later actions (especially the target-item evidence chip) run.
      const reachableItemIds: Set<string> = collectItemIds(model);
      const sectionItemCounts = new Map<string, number>();
      for (const section of model.sections) {
        sectionItemCounts.set(section.id, section.items.length);
      }

      // ── Build the final action list ────────────────────────────────────────
      const finalActions: Action[] = [];

      for (const action of rawActions) {
        if (action.type === "attachEvidence") {
          // Guard: only include if the item exists or will be created by a
          // preceding proposeItem — prevents a reducer throw that would abort
          // dispatch before the target-item evidence chip below runs.
          if (!reachableItemIds.has(action.itemId)) {
            continue;
          }
          // Stamp dossierRef + checkedAt per the contract.
          finalActions.push({
            type: "attachEvidence" as const,
            actor: action.actor,
            itemId: action.itemId,
            evidence: {
              source: action.evidence.source,
              method: action.evidence.method,
              checkedAt,
              dossierRef,
            },
          });
        } else if (action.type === "proposeItem") {
          // Push the proposeItem, track the predicted new item ID, then attach
          // evidence to it. The reducer assigns id = `item-<sectionId>-<count>`.
          finalActions.push(action);
          const count = sectionItemCounts.get(action.sectionId) ?? 0;
          const predictedItemId = `item-${action.sectionId}-${count}`;
          sectionItemCounts.set(action.sectionId, count + 1);
          reachableItemIds.add(predictedItemId);
          finalActions.push({
            type: "attachEvidence" as const,
            actor: "research" as const,
            itemId: predictedItemId,
            evidence: {
              source: subjectText,
              method: "research",
              checkedAt,
              dossierRef,
            },
          });
        } else if (action.type === "addItemNote") {
          // Guard: only include if the target item exists or will be created by
          // a preceding proposeItem. An addItemNote for an unknown item causes a
          // reducer THROW, aborting dispatch before the target-item chip below.
          if (!reachableItemIds.has(action.itemId)) {
            continue;
          }
          finalActions.push(action);
        } else {
          // All other actions (proposeEdit, etc.) from the LLM: guard any that
          // target a specific itemId the same way — if the field exists and the
          // item is unknown, skip it to prevent a reducer throw.
          const maybeItemTargeted = action as { itemId?: string };
          if (
            maybeItemTargeted.itemId !== undefined &&
            !reachableItemIds.has(maybeItemTargeted.itemId)
          ) {
            continue;
          }
          finalActions.push(action);
        }
      }

      // ── Attach evidence to the specific research target item ───────────────
      // When triggered on a specific item, that item must carry provenance
      // regardless of what the LLM returned. The guard prevents a reducer throw
      // when the item id is somehow stale (shouldn't happen, but defensive).
      if (
        target.itemId !== undefined &&
        findItemText(model, target.itemId) !== undefined
      ) {
        finalActions.push({
          type: "attachEvidence" as const,
          actor: "research" as const,
          itemId: target.itemId,
          evidence: {
            source: subjectText,
            method: "research",
            checkedAt,
            dossierRef,
          },
        });
      }

      return finalActions;
    },
  };
}

// ===== Default DossierStore =====

/**
 * Build a dossier markdown document from the research round's output.
 */
function buildDossierContent(
  subject: string,
  topic: string,
  existing: string | undefined,
  proposedItems: string[],
  now: Date,
): string {
  const timestamp = now.toISOString();
  const header = `# Research Dossier: ${subject}\n\nTopic: \`${topic}\`  \nLast updated: ${timestamp}\n\n`;

  if (!existing) {
    const itemsBlock =
      proposedItems.length > 0
        ? `## Proposed Findings\n\n${proposedItems.join("\n")}\n`
        : "## Proposed Findings\n\n(No findings recorded in this round.)\n";
    return header + itemsBlock;
  }

  // Append a new findings section to the existing dossier
  const appendBlock =
    proposedItems.length > 0
      ? `\n\n## Findings (updated ${timestamp})\n\n${proposedItems.join("\n")}\n`
      : `\n\n<!-- Round run at ${timestamp} — no new findings. -->\n`;
  return existing + appendBlock;
}

/**
 * Create the default DossierStore rooted at <sidecarRoot>/<namespace>/research/.
 * This is the deps.dossier default wired in the session.
 */
export function makeDefaultDossierStore(
  sidecarRoot: string,
  namespace: string,
  space?: string,
): DossierStore {
  // Per-SPACE research (2026-07-18): each space owns its digests under
  // research/<space>/ so two spaces never overwrite each other's _ask-N.md and
  // deleting a space can remove its whole research folder. Space-relative ref
  // (space ? research/<space>/<topic>.md : research/<topic>.md) resolves under
  // <sidecarRoot>/<namespace>/.
  const rel = space ? `research/${space}` : "research";
  const dir = nodePath.join(sidecarRoot, namespace, rel);

  return {
    async read(topic: string): Promise<string | undefined> {
      const filePath = nodePath.join(dir, `${topic}.md`);
      try {
        return await nodeFs.readFile(filePath, "utf8");
      } catch {
        return undefined;
      }
    },

    async write(
      topic: string,
      markdown: string,
    ): Promise<{ dossierRef: string }> {
      await nodeFs.mkdir(dir, { recursive: true });
      const filePath = nodePath.join(dir, `${topic}.md`);
      await nodeFs.writeFile(filePath, markdown, "utf8");
      return { dossierRef: `${rel}/${topic}.md` };
    },
  };
}
