// src/scratchpad/workers/interpreter.ts
// Command-field interpreter (SP-21/3, SL-5).
//
// interpret(utterance, model, deps) → Promise<{ actions: Action[]; message?: string }>
//
// Every returned action carries actor:"human" — the utterance IS the human's act.
// Bulk commands expand deterministically (no query round needed).
// GATES.interpreter limits the allowed vocabulary; freeze is absent.
// Gate violations and unrecognized utterances surface as { actions:[], message }
// — never thrown.

import type { Action, SectionKind, WorkingModel } from "../model";
import { GATES, assertWithinGate } from "./worker";
import type { QueryFn } from "./worker";

export interface InterpretResult {
  actions: Action[];
  message?: string;
}

// ── Section-kind noun map ─────────────────────────────────────────────────────
// Maps the nouns a human might say to a section kind.

const SECTION_NOUN_MAP: Record<string, SectionKind> = {
  // singular and plural forms
  constraint: "constraints",
  constraints: "constraints",
  element: "elements",
  elements: "elements",
  gap: "gap",
  gaps: "gap",
  criteria: "criteria",
  criterion: "criteria",
  verification: "verification",
  verifications: "verification",
  list: "constraints", // generic "list" falls through to constraints; see "all lists"
};

// ── Bulk-expansion helpers ────────────────────────────────────────────────────

/**
 * "accept all <noun>" → checkItem for every unchecked active item in the named section.
 * "accept all lists" → checkItem for every unchecked active item in ALL sections.
 *
 * Returns null if the utterance does not match a known bulk pattern.
 */
function tryBulkExpansion(
  utterance: string,
  model: WorkingModel,
): Action[] | null {
  const lower = utterance.trim().toLowerCase();

  // "accept all lists" / "accept all" (no noun) → all sections
  if (lower === "accept all lists" || lower === "accept all") {
    const actions: Action[] = [];
    for (const section of model.sections) {
      for (const item of section.items) {
        if (!item.checked && item.state === "active") {
          actions.push({
            type: "checkItem",
            actor: "human",
            itemId: item.id,
          });
        }
      }
    }
    return actions;
  }

  // "accept all <noun>" where <noun> maps to a known section kind
  const acceptAllMatch = lower.match(/^accept\s+all\s+(\w+)$/);
  if (acceptAllMatch) {
    const noun = acceptAllMatch[1];
    const kind = SECTION_NOUN_MAP[noun];
    if (kind !== undefined) {
      const section = model.sections.find((s) => s.kind === kind);
      if (!section) {
        return []; // section kind not in model → no-op (not an error)
      }
      const actions: Action[] = [];
      for (const item of section.items) {
        if (!item.checked && item.state === "active") {
          actions.push({
            type: "checkItem",
            actor: "human",
            itemId: item.id,
          });
        }
      }
      return actions;
    }
  }

  return null; // not a recognized bulk pattern
}

// ── Gate-safe query round ─────────────────────────────────────────────────────

/**
 * Run a query round for the utterance, then filter any action that violates
 * GATES.interpreter (notably freeze). Returns actions + an optional message
 * explaining a gate refusal or an empty result.
 */
async function queryRound(
  utterance: string,
  model: WorkingModel,
  loadQuery: () => QueryFn,
): Promise<InterpretResult> {
  // Build QueryOptions from GATES.interpreter
  const options = {
    model: "sonnet",
    allowedTools: GATES.interpreter.allowedTools,
    disallowedTools: GATES.interpreter.disallowedTools,
  };

  const prompt =
    `You are a command-field interpreter. Translate the human's plain-language command into ` +
    `structured actions on the thinking space. Every action you produce MUST carry actor:"human". ` +
    `The human UI vocabulary is: addItem, checkItem, uncheckItem, editItemText, setModality, setEval, ` +
    `deferItem, dropItem, supersedeItem, resolveEdit, addItemNote. ` +
    `Freeze is NOT available — do not produce a freeze action. ` +
    `If the command cannot be translated into the available vocabulary, return zero actions.\n\n` +
    `Working model (JSON):\n${JSON.stringify(model, null, 2)}\n\n` +
    `Human command: "${utterance}"\n\n` +
    `Respond with a JSON object: { "actions": [...], "message": "optional explanation" }`;

  const query = loadQuery();
  const rawActions: Action[] = [];

  for await (const msg of query({ prompt, options })) {
    if (msg.type === "actions") {
      rawActions.push(...msg.actions);
    }
  }

  // Gate-check every returned action; catch violations without throwing
  const validActions: Action[] = [];
  let gateMessage: string | undefined;

  for (const action of rawActions) {
    try {
      assertWithinGate(options, action.type as import("../model").ToolName);
      // Ensure every action carries actor:"human"
      const patched = ensureHumanActor(action);
      validActions.push(patched);
    } catch (err) {
      // Gate violation — catch it, surface as message, discard all actions
      const msg =
        err instanceof Error ? err.message : `Gate violation: ${action.type}`;
      gateMessage = `Command not applied: ${msg}`;
      // Return empty — the spec says a gate refusal → { actions:[], message }
      return { actions: [], message: gateMessage };
    }
  }

  // Zero actions after gating → unrecognized utterance
  if (validActions.length === 0) {
    return {
      actions: [],
      message:
        `I didn't understand "${utterance}". ` +
        `Try commands like "accept all constraints", "add this constraint: …", or "defer item <id>".`,
    };
  }

  return { actions: validActions };
}

/**
 * Ensure the action carries actor:"human".
 * For action types that carry an `actor` field (all SP-21/3 item actions), we
 * force the value. For action types that do not carry actor (SP-1 actions like
 * editGoal), we leave them as-is — interpreter gate only allows item vocabulary.
 */
function ensureHumanActor(action: Action): Action {
  // Most item actions in GATES.interpreter carry actor
  if ("actor" in action && (action as { actor: string }).actor !== "human") {
    return { ...action, actor: "human" } as Action;
  }
  return action;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Interpret a plain-language utterance into human-attributed model actions.
 *
 * - Bulk "accept all …" commands expand deterministically (no query round).
 * - Other utterances are routed through the model connection.
 * - Any action violating GATES.interpreter (including freeze) is caught inside
 *   interpret and surfaces as { actions:[], message } — never thrown.
 * - An unrecognized utterance returns { actions:[], message } with a plain
 *   explanation.
 */
export async function interpret(
  utterance: string,
  model: WorkingModel,
  deps: { loadQuery: () => QueryFn },
): Promise<InterpretResult> {
  // 1. Try deterministic bulk expansion first
  const bulkActions = tryBulkExpansion(utterance, model);
  if (bulkActions !== null) {
    return { actions: bulkActions };
  }

  // 2. Fall through to model round
  try {
    return await queryRound(utterance, model, deps.loadQuery);
  } catch (err) {
    // Unexpected error from the query itself — surface as message, no throw
    const msg = err instanceof Error ? err.message : String(err);
    return {
      actions: [],
      message: `Command failed: ${msg}`,
    };
  }
}
