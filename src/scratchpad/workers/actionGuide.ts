/**
 * Action guide + normalization seam for scratchpad worker rounds.
 *
 * Root cause this module removes (field defect, 2026-07-16): worker prompts told
 * the model to "conform to the Action type" without ever SHOWING the Action type,
 * and listed sections by kind label without disclosing sectionId — so a worker
 * could not possibly emit a valid `proposeItem`. It invented a plausible shape
 * ({"tool":"proposeItem","section":"Context","text":...}) which the reducer's
 * exhaustive switch rejected with a raw throw, aborting the round mid-dispatch
 * (actions before the bad one already applied — partial application).
 *
 * Two sanctioned paths replace the guessing game:
 *
 *  - renderActionGuide(): a prompt block carrying the live sectionId/itemId
 *    values and an exact JSON worked example for every tool the worker's gate
 *    allows. ID lists are included ONLY when an allowed tool consumes them, so
 *    prompts with deliberate blindness (reframe: checked-items-only) leak nothing.
 *
 *  - normalizeWorkerActions(): the validation seam between parsed worker JSON
 *    and the reducer. Coerces common aliases ("tool" → "type", section kind
 *    name → sectionId, flat "text" → item object), enforces the worker's gate
 *    mechanically, and turns everything unsalvageable into a rejected entry
 *    with a reason — a malformed action can no longer abort a round or reach
 *    the reducer's throw sites.
 */

import type {
  Action,
  Evidence,
  Modality,
  ToolName,
  WorkingModel,
} from "../model";

/** Worker actors — every scratchpad round actor except the human. */
export type WorkerActor = "gap-filler" | "integrator" | "research";

export interface RejectedAction {
  raw: unknown;
  reason: string;
}

export interface NormalizeResult {
  valid: Action[];
  rejected: RejectedAction[];
}

export interface NormalizeOptions {
  defaultActor: WorkerActor;
  allowedTools: ToolName[];
  /** ISO timestamp used to fill a missing evidence.checkedAt (research rounds). */
  nowIso?: string;
}

// Tools a worker round may express through this seam. Anything else (human/
// interpreter vocabulary, freeze, …) is rejected here regardless of gate.
const WORKER_EMITTABLE: ReadonlySet<string> = new Set([
  "proposeItem",
  "proposeEdit",
  "addItemNote",
  "attachEvidence",
  "editGoal",
  "addObjection",
]);

const SECTION_TAKING: ReadonlySet<string> = new Set(["proposeItem"]);
const ITEM_TAKING: ReadonlySet<string> = new Set([
  "proposeEdit",
  "addItemNote",
  "attachEvidence",
]);

// ── Small coercion helpers ───────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function asEvalValue(v: unknown): 1 | 2 | 3 | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return n === 1 || n === 2 || n === 3 ? n : undefined;
}

function asModality(v: unknown): Modality {
  return v === "mandatory" ? "mandatory" : "optional";
}

function asWorkerActor(v: unknown, fallback: WorkerActor): WorkerActor {
  return v === "gap-filler" || v === "integrator" || v === "research"
    ? v
    : fallback;
}

/** Resolve a section reference: exact id first, then kind name (case-insensitive). */
function resolveSectionId(model: WorkingModel, ref: unknown): string | null {
  const s = asNonEmptyString(ref);
  if (s === null) return null;
  const byId = model.sections.find((sec) => sec.id === s);
  if (byId) return byId.id;
  const kind = s.trim().toLowerCase();
  const byKind = model.sections.find((sec) => sec.kind === kind);
  return byKind ? byKind.id : null;
}

function sectionKindOf(model: WorkingModel, sectionId: string): string | null {
  const sec = model.sections.find((s) => s.id === sectionId);
  return sec ? sec.kind : null;
}

/** Resolve an item reference to an existing item id (exact match only). */
function resolveItemId(model: WorkingModel, ref: unknown): string | null {
  const s = asNonEmptyString(ref);
  if (s === null) return null;
  for (const sec of model.sections) {
    if (sec.items.some((it) => it.id === s)) return s;
  }
  return null;
}

// ── renderActionGuide ────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Render the prompt block disclosing the exact action contract for one worker
 * round: live IDs (only those the gate's tools consume) plus an exact JSON
 * worked example per allowed tool.
 */
export function renderActionGuide(
  model: WorkingModel,
  allowedTools: ToolName[],
  actor: WorkerActor,
): string {
  const allowed = allowedTools.filter((t) => WORKER_EMITTABLE.has(t));
  const needsSections = allowed.some((t) => SECTION_TAKING.has(t));
  const needsItems = allowed.some((t) => ITEM_TAKING.has(t));

  const lines: string[] = [
    "## How to emit actions (exact contract — malformed actions are rejected)",
    "",
    'Respond with EXACTLY ONE JSON object: {"actions":[ ...action objects... ]}',
    'Every action object uses the key "type" (never "tool" or "name"), shaped exactly as shown below.',
  ];

  const nonGoalSections = model.sections.filter((s) => s.kind !== "goal");
  const exampleSectionId =
    nonGoalSections.length > 0 ? nonGoalSections[0].id : "<sectionId>";

  if (needsSections) {
    lines.push("", "Live sections — the ONLY sectionId values you may target:");
    for (const sec of nonGoalSections) {
      lines.push(`- "${sec.id}" (the ${sec.kind} section)`);
    }
    if (nonGoalSections.length === 0) {
      lines.push("- (none yet)");
    }
  }

  let exampleItemId = "<itemId>";
  if (needsItems) {
    const itemLines: string[] = [];
    for (const sec of model.sections) {
      for (const it of sec.items) {
        if (itemLines.length === 0) exampleItemId = it.id;
        itemLines.push(`- "${it.id}" [${sec.kind}] "${truncate(it.text, 80)}"`);
      }
    }
    lines.push("", "Live items — the ONLY itemId values you may target:");
    lines.push(...(itemLines.length > 0 ? itemLines : ["- (none yet)"]));
  }

  const shapes: Partial<Record<ToolName, string>> = {
    proposeItem:
      `{"type":"proposeItem","actor":"${actor}","sectionId":"${exampleSectionId}",` +
      `"item":{"text":"<the item text>","modality":"optional","evals":{"complexity":2,"risk":1}}}` +
      ` — modality is "mandatory" or "optional"; evals values are 1|2|3 (omit a facet if unsure)`,
    proposeEdit: `{"type":"proposeEdit","actor":"${actor}","itemId":"${exampleItemId}","newText":"<replacement text>"}`,
    addItemNote: `{"type":"addItemNote","actor":"${actor}","itemId":"${exampleItemId}","text":"<the note>"}`,
    attachEvidence:
      `{"type":"attachEvidence","actor":"${actor}","itemId":"${exampleItemId}",` +
      `"evidence":{"source":"<where>","method":"<how verified>","checkedAt":"<ISO timestamp>","dossierRef":"research/<topic>.md"}}`,
    editGoal: `{"type":"editGoal","text":"<the rewritten goal statement>"}`,
    addObjection: `{"type":"addObjection","text":"<the objection>"}`,
  };

  lines.push(
    "",
    "Exact shape for each action you are allowed to emit (copy the shape, replace only the values):",
  );
  for (const tool of allowed) {
    const shape = shapes[tool];
    if (shape) lines.push(`- ${tool} → ${shape}`);
  }

  lines.push(
    "",
    "Rules:",
    "- Use ONLY the sectionId/itemId values listed above. Never invent an ID; never use a section's display name in place of its sectionId.",
    `- You may emit ONLY these action types: ${allowed.join(", ") || "(none)"}. Anything else is rejected.`,
  );

  return lines.join("\n");
}

// ── normalizeWorkerActions ───────────────────────────────────────────────────

/**
 * Validate + coerce raw parsed worker actions against the live model and the
 * worker's gate. Salvages common shape drift; everything unsalvageable lands
 * in `rejected` with a human-readable reason instead of reaching the reducer.
 */
export function normalizeWorkerActions(
  rawActions: unknown[],
  model: WorkingModel,
  opts: NormalizeOptions,
): NormalizeResult {
  const valid: Action[] = [];
  const rejected: RejectedAction[] = [];
  const gate = new Set<string>(opts.allowedTools);

  for (const raw of rawActions) {
    const rec = asRecord(raw);
    if (rec === null) {
      rejected.push({ raw, reason: "action is not a JSON object" });
      continue;
    }
    const type = asNonEmptyString(rec.type ?? rec.tool ?? rec.name);
    if (type === null) {
      rejected.push({ raw, reason: "action carries no type" });
      continue;
    }
    if (!WORKER_EMITTABLE.has(type)) {
      rejected.push({ raw, reason: `unknown worker action type '${type}'` });
      continue;
    }
    if (!gate.has(type)) {
      rejected.push({
        raw,
        reason: `'${type}' is outside this worker's gate`,
      });
      continue;
    }

    switch (type) {
      case "proposeItem": {
        const sectionId = resolveSectionId(
          model,
          rec.sectionId ?? rec.section ?? rec.sectionKind,
        );
        if (sectionId === null) {
          rejected.push({
            raw,
            reason: `proposeItem targets an unknown section (${JSON.stringify(
              rec.sectionId ?? rec.section ?? rec.sectionKind ?? null,
            )})`,
          });
          continue;
        }
        if (sectionKindOf(model, sectionId) === "goal") {
          rejected.push({
            raw,
            reason: "items cannot be proposed on the goal section",
          });
          continue;
        }
        const itemRec = asRecord(rec.item);
        const text = asNonEmptyString(itemRec?.text ?? rec.text);
        if (text === null) {
          rejected.push({ raw, reason: "proposeItem carries no item text" });
          continue;
        }
        const evalsRec = asRecord(itemRec?.evals ?? rec.evals) ?? {};
        const evals: { complexity?: 1 | 2 | 3; risk?: 1 | 2 | 3 } = {};
        const complexity = asEvalValue(evalsRec.complexity);
        const risk = asEvalValue(evalsRec.risk);
        if (complexity !== undefined) evals.complexity = complexity;
        if (risk !== undefined) evals.risk = risk;
        valid.push({
          type: "proposeItem",
          actor: asWorkerActor(rec.actor, opts.defaultActor),
          sectionId,
          item: {
            text,
            modality: asModality(itemRec?.modality ?? rec.modality),
            evals,
          },
        });
        continue;
      }

      case "proposeEdit": {
        const itemId = resolveItemId(model, rec.itemId ?? rec.id ?? rec.item);
        if (itemId === null) {
          rejected.push({
            raw,
            reason: "proposeEdit targets an unknown item",
          });
          continue;
        }
        const newText = asNonEmptyString(rec.newText ?? rec.text);
        if (newText === null) {
          rejected.push({ raw, reason: "proposeEdit carries no newText" });
          continue;
        }
        valid.push({
          type: "proposeEdit",
          actor: asWorkerActor(rec.actor, opts.defaultActor),
          itemId,
          newText,
        });
        continue;
      }

      case "addItemNote": {
        const itemId = resolveItemId(model, rec.itemId ?? rec.id ?? rec.item);
        if (itemId === null) {
          rejected.push({
            raw,
            reason: "addItemNote targets an unknown item",
          });
          continue;
        }
        const text = asNonEmptyString(rec.text ?? rec.note);
        if (text === null) {
          rejected.push({ raw, reason: "addItemNote carries no text" });
          continue;
        }
        // The Action type declares addItemNote actor as "human", yet the
        // gap-filler/integrator/research gates all grant addItemNote — a
        // type/gate drift (ledgered). The reducer ignores the actor for notes;
        // we keep the true worker actor for honest provenance and cast.
        valid.push({
          type: "addItemNote",
          actor: asWorkerActor(rec.actor, opts.defaultActor),
          itemId,
          text,
        } as unknown as Action);
        continue;
      }

      case "attachEvidence": {
        const itemId = resolveItemId(model, rec.itemId ?? rec.id ?? rec.item);
        if (itemId === null) {
          rejected.push({
            raw,
            reason: "attachEvidence targets an unknown item",
          });
          continue;
        }
        const evRec = asRecord(rec.evidence) ?? rec;
        const source = asNonEmptyString(evRec.source);
        const method = asNonEmptyString(evRec.method);
        if (source === null || method === null) {
          rejected.push({
            raw,
            reason: "attachEvidence needs evidence.source and evidence.method",
          });
          continue;
        }
        const checkedAt = asNonEmptyString(evRec.checkedAt) ?? opts.nowIso;
        if (checkedAt === undefined) {
          rejected.push({
            raw,
            reason: "attachEvidence carries no checkedAt (and no round timestamp available)",
          });
          continue;
        }
        const evidence: Evidence = { source, method, checkedAt };
        const dossierRef = asNonEmptyString(evRec.dossierRef);
        if (dossierRef !== null) evidence.dossierRef = dossierRef;
        valid.push({
          type: "attachEvidence",
          actor: asWorkerActor(rec.actor, opts.defaultActor),
          itemId,
          evidence,
        });
        continue;
      }

      case "editGoal": {
        if (typeof rec.text !== "string") {
          rejected.push({ raw, reason: "editGoal carries no text" });
          continue;
        }
        // Empty text is passed through — the reducer's erasure guard owns that
        // invariant (empty rewrite over a non-empty intent is rejected there).
        valid.push({ type: "editGoal", text: rec.text });
        continue;
      }

      case "addObjection": {
        const text = asNonEmptyString(rec.text);
        if (text === null) {
          rejected.push({ raw, reason: "addObjection carries no text" });
          continue;
        }
        valid.push({ type: "addObjection", text });
        continue;
      }
    }
  }

  return { valid, rejected };
}
