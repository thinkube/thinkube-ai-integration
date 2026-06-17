/**
 * Quality gates for kanban column transitions.
 *
 * Pure functions: take an input shape, return `{ ok: true } | { ok: false,
 * reason: string }`. No I/O — the caller (kanban adapter, MCP server,
 * `/pair-next` skill) is responsible for fetching what the gate needs.
 *
 * Three gates ship in v0.1.0, one per workflow boundary:
 *
 *   Spec        → Ready     `gateSpecToReady`      (acceptance criteria checklist not empty)
 *   In Progress → Review    `gateInProgressToReview` (at least one comment exists)
 *   Review      → Verify    `gateReviewToVerify`   (all acceptance criteria boxes checked)
 *
 * Gates 1 and 3 read the spec body's `## Acceptance Criteria` section.
 * Both `## acceptance criteria` and `## Acceptance Criteria` are recognised
 * (case-insensitive); any of `- [ ]`, `- [x]`, `* [ ]`, `+ [x]` count as
 * checklist items. The section ends at the next `## ` heading or end-of-file.
 *
 * Gate 2 currently checks the existence of any comment. The plan's longer
 * goal is "at least one comment from this work cycle" — tracking the
 * card's last "In Progress" timestamp is a chunk-13 refinement. For v0.1.0
 * the simpler form catches the common case (someone forgot to leave any
 * note about the work).
 */

export type GateResult = { ok: true } | { ok: false; reason: string };

export interface SpecBodyInput {
  /** Issue body text. Pass either the GitHub issue body or the linked `.thinkube/specs/SP-{n}.md` body — both share the same convention. */
  specBody: string | null | undefined;
}

export interface CommentsInput {
  /** Total comment count on the issue. Sufficient for the v0.1.0 form of gate 2. */
  commentCount: number;
}

export function gateSpecToReady(input: SpecBodyInput): GateResult {
  const items = extractAcceptanceCriteria(input.specBody ?? "");
  if (items.length === 0) {
    return {
      ok: false,
      reason:
        "Cannot move to Ready: spec has no `## Acceptance Criteria` checklist. Add at least one `- [ ]` item under that heading.",
    };
  }
  return { ok: true };
}

export function gateInProgressToReview(input: CommentsInput): GateResult {
  if (input.commentCount === 0) {
    return {
      ok: false,
      reason:
        "Cannot move to Review: no comments on the issue. Leave at least one comment summarising the change (link to the PR, summary of the approach, etc.).",
    };
  }
  return { ok: true };
}

export function gateReviewToVerify(input: SpecBodyInput): GateResult {
  const items = extractAcceptanceCriteria(input.specBody ?? "");
  if (items.length === 0) {
    return {
      ok: false,
      reason:
        "Cannot move to Verify: parent spec has no `## Acceptance Criteria` checklist to verify against.",
    };
  }
  const unchecked = items.filter((i) => !i.checked);
  if (unchecked.length > 0) {
    return {
      ok: false,
      reason: `Cannot move to Verify: ${unchecked.length} acceptance criterion${unchecked.length === 1 ? "" : "ia"} still unchecked in parent spec.`,
    };
  }
  return { ok: true };
}

export interface AcceptanceItem {
  label: string;
  checked: boolean;
}

/**
 * Extract checkbox items under the `## Acceptance Criteria` heading. Returns
 * `[]` when the section is missing or empty. Exported for direct use by the
 * `/pair-next` skill and MCP tools that want to inspect criteria.
 */
export function extractAcceptanceCriteria(body: string): AcceptanceItem[] {
  const lines = body.split(/\r?\n/);
  let inSection = false;
  const items: AcceptanceItem[] = [];
  for (const rawLine of lines) {
    const heading = /^(#{2,6})\s+(.+?)\s*$/.exec(rawLine);
    if (heading) {
      const text = heading[2].trim().toLowerCase();
      inSection =
        text === "acceptance criteria" || text === "acceptance_criteria";
      continue;
    }
    if (!inSection) continue;
    const checkbox = /^\s*[-*+]\s*\[([ xX])\]\s+(.+?)\s*$/.exec(rawLine);
    if (!checkbox) continue;
    items.push({
      label: checkbox[2],
      checked: checkbox[1].toLowerCase() === "x",
    });
  }
  return items;
}

/**
 * Look up the gate for a (fromColumn, toColumn) transition by their human
 * names (matches the methodology bundle's column option values:
 * "Spec", "Ready", "In Progress", "Review", "Verify", "Done").
 *
 * Returns `undefined` when there's no gate for that transition — the move
 * is allowed unconditionally. Callers should treat absence as "ok".
 */
export type TransitionKey = `${string}→${string}`;

export type GateName =
  | "spec-to-ready"
  | "in-progress-to-review"
  | "review-to-verify";

export function gateForTransition(
  fromColumn: string,
  toColumn: string,
): GateName | undefined {
  if (fromColumn === "Spec" && toColumn === "Ready") return "spec-to-ready";
  if (fromColumn === "In Progress" && toColumn === "Review")
    return "in-progress-to-review";
  if (fromColumn === "Review" && toColumn === "Verify")
    return "review-to-verify";
  return undefined;
}

// ─── Tandem (files-first, 3-column) gates ────────────────────────────────
//
// The Tandem board has three columns — Ready → Doing → Done — and two gates,
// keyed by *destination* column (ADR-0003/0007):
//
//   → Ready : the slice's parent Spec has a non-empty `## Acceptance Criteria`.
//   → Done  : every acceptance criterion on the parent Spec is checked.
//
// The "→ Done" gate's other half — verifier green for the slice — is a runtime
// check enforced by `/pair-next`, not a file check. Ready→Doing and any other
// move is ungated. These reuse the same body-reading checks as the 6-column
// gates above; the legacy `gateForTransition` / `GateName` stay until their
// consumers are removed (migration phases 5–7).

export type TandemGateName = "to-ready" | "to-done";

/**
 * Resolve the Tandem gate for a move by its destination column. Returns
 * `undefined` for ungated moves (e.g. → Doing); callers treat absence as ok.
 */
export function gateForTandemTransition(
  toColumn: string,
): TandemGateName | undefined {
  if (toColumn === "Ready") return "to-ready";
  if (toColumn === "Done") return "to-done";
  return undefined;
}

/** Run a Tandem gate against the parent Spec's body. */
export function runTandemGate(
  gate: TandemGateName,
  input: SpecBodyInput,
): GateResult {
  switch (gate) {
    case "to-ready":
      return gateSpecToReady(input);
    case "to-done":
      return gateReviewToVerify(input);
  }
}

// ─── Per-slice → Done gate (SP-6: the mechanical half) ───────────────────
//
// The → Done gate above (`gateReviewToVerify`) is whole-Spec: it wants *every*
// criterion checked. That can't gate a single slice on a multi-slice Spec —
// the first slice would be stuck until the last. The mechanical half SP-6 wires
// into `move_slice` is instead keyed by the slice's own `satisfies` ordinals:
// a slice may enter Done only once the criteria *it* delivers are checked. This
// is a sequencing/integrity check, not independent review — the same contract
// that authorises the AI to check the boxes also requires Done to stay
// unreachable while the Spec document lags the board.

export interface SatisfiesGateInput {
  /** Parent Spec body — its `## Acceptance Criteria` is read. */
  specBody: string | null | undefined;
  /** 1-based AC ordinals the slice delivers (frontmatter `satisfies`). */
  satisfies: number[] | null | undefined;
}

export type SatisfiesGateResult =
  | { ok: true; gateSkipped?: string }
  | { ok: false; reason: string };

/**
 * Gate a slice's move to Done by its `satisfies` ordinals. Refuses (naming the
 * offending ordinal + its text) when any listed criterion is unchecked or
 * out-of-range on the parent Spec. Legacy-tolerant: a slice with no ordinals is
 * not gated — `{ ok: true, gateSkipped: "no satisfies field" }` — so slices
 * authored before this field keep moving.
 */
export function gateSliceSatisfiesToDone(
  input: SatisfiesGateInput,
): SatisfiesGateResult {
  const raw = Array.isArray(input.satisfies) ? input.satisfies : [];
  const ordinals = [
    ...new Set(raw.filter((n) => Number.isInteger(n) && n > 0)),
  ].sort((a, b) => a - b);
  if (ordinals.length === 0) {
    return { ok: true, gateSkipped: "no satisfies field" };
  }
  const items = extractAcceptanceCriteria(input.specBody ?? "");
  const problems: string[] = [];
  for (const ordinal of ordinals) {
    const item = items[ordinal - 1];
    if (!item) {
      problems.push(
        `#${ordinal} (the parent Spec lists ${items.length} acceptance ${items.length === 1 ? "criterion" : "criteria"})`,
      );
    } else if (!item.checked) {
      problems.push(`#${ordinal} ("${clampLabel(item.label)}")`);
    }
  }
  if (problems.length === 0) return { ok: true };
  const noun =
    problems.length === 1
      ? "acceptance criterion is"
      : "acceptance criteria are";
  return {
    ok: false,
    reason:
      `Cannot move to Done: this slice's satisfied ${noun} not checked on the parent Spec — AC ${problems.join(", ")}. ` +
      `Check the box(es) under the Spec's ## Acceptance Criteria, then retry the move.`,
  };
}

// ─── Spec acceptance gate (TEP-0010: the single human gate at the end) ───
//
// A Spec is "accepted" — its acceptance card reaches Done and the one PR merges —
// only when (a) every slice under it is Done and (b) every acceptance criterion is
// checked. The human-accept itself is the act of calling `accept_spec`; this gate
// is the precondition the server enforces before recording it. Per TEP-0010 this
// re-introduces a human sign-off, but only at Spec granularity — per-slice stays
// automated via `gateSliceSatisfiesToDone`.

export interface SpecAcceptanceGateInput {
  /** Parent Spec body — its `## Acceptance Criteria` is read. */
  specBody: string | null | undefined;
  /** `status:` of every slice under the Spec (the acceptance card excluded). */
  sliceStatuses: readonly string[];
}

export function gateSpecAcceptance(input: SpecAcceptanceGateInput): GateResult {
  const notDone = input.sliceStatuses.filter(
    (s) => (s ?? "").toLowerCase() !== "done",
  ).length;
  if (notDone > 0) {
    return {
      ok: false,
      reason: `Cannot accept the Spec: ${notDone} slice${notDone === 1 ? " is" : "s are"} not yet Done.`,
    };
  }
  const items = extractAcceptanceCriteria(input.specBody ?? "");
  if (items.length === 0) {
    return {
      ok: false,
      reason:
        "Cannot accept the Spec: it has no `## Acceptance Criteria` to accept against.",
    };
  }
  const unchecked = items.filter((i) => !i.checked).length;
  if (unchecked > 0) {
    return {
      ok: false,
      reason: `Cannot accept the Spec: ${unchecked} acceptance criterion${unchecked === 1 ? " is" : "ia are"} still unchecked on the Spec.`,
    };
  }
  return { ok: true };
}

function clampLabel(label: string, max = 100): string {
  const s = label.trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

export class GateFailedError extends Error {
  constructor(
    public readonly gate: GateName,
    public readonly reason: string,
  ) {
    super(reason);
    this.name = "GateFailedError";
  }
}

// ── Documentation obligation (TEP-tgh6iy) ──────────────────────────────────

export type DocsObligation = { docs: "required" | "n/a"; docs_reason?: string };

/**
 * Normalize + validate a slice's documentation obligation (TEP-tgh6iy).
 * Default is `required` — fail closed: user-facing work is assumed unless the
 * slicer declares `n/a`, which must carry a one-line reason so skipping docs is
 * a visible, deliberate choice, never silent. Pure: returns a result, never
 * throws — the caller decides how to surface a rejection.
 */
export function resolveDocsObligation(input: {
  docs?: string | undefined;
  docs_reason?: string | undefined;
}): { ok: true; value: DocsObligation } | { ok: false; reason: string } {
  const docs = (input.docs ?? "required").trim();
  if (docs !== "required" && docs !== "n/a") {
    return {
      ok: false,
      reason: `Invalid docs "${input.docs}" — expected "required" or "n/a".`,
    };
  }
  const docs_reason = input.docs_reason?.trim() || undefined;
  if (docs === "n/a" && !docs_reason) {
    return {
      ok: false,
      reason:
        "docs: n/a requires a one-line docs_reason justifying why this slice needs no documentation (TEP-tgh6iy) — skipping docs must be a visible, deliberate choice.",
    };
  }
  return {
    ok: true,
    value: docs === "n/a" ? { docs, docs_reason } : { docs: "required" },
  };
}

export type DocsGateMode = "advisory" | "blocking";

/**
 * → Done docs gate (TEP-tgh6iy). A slice declaring `docs: required` must have
 * its documentation done before it reaches Done. In `blocking` mode an
 * unsatisfied obligation **refuses** the move; in `advisory` mode it **passes
 * with a warning** so the gate can roll out before it bites. A slice that is
 * `n/a`, or a legacy slice with no `docs` field, is ungated.
 *
 * Pure: no I/O. The caller reads `docs`/`docs_done` off the slice frontmatter
 * and the mode off config, then surfaces `reason` (refusal) or `warning`.
 */
export function gateSliceDocsToDone(input: {
  docs?: string | undefined;
  docsDone?: boolean | undefined;
  mode: DocsGateMode;
}): { ok: true; warning?: string } | { ok: false; reason: string } {
  // n/a or legacy/unset → ungated (mirrors the satisfies gate's skip).
  if (input.docs !== "required") return { ok: true };
  if (input.docsDone === true) return { ok: true };
  const msg =
    "docs: required — update this slice's documentation (docs-with-code) and pass docs_done before → Done (TEP-tgh6iy).";
  return input.mode === "blocking"
    ? { ok: false, reason: msg }
    : { ok: true, warning: `${msg} [advisory — allowed, but please confirm]` };
}

// ── AC verification under the lever (SP-tgsdvw; relaxes TEP-tgnvkw) ──────────
//
// tgnvkw's absolute "AC must be AI-verifiable" becomes **AI-testability-gated** (a lever
// input, per-AC). High testability → the AI must self-certify: AI evidence is required and
// a bare human verdict does NOT substitute (the no-dodge guard — never hand-wave what the
// AI could verify). Low testability → an explicit human verdict is legitimate, no longer a
// defect. Pure: the caller supplies the per-AC inputs (their storage is SP-tgsdvw's
// deferred wiring — see its Open questions).

export type AiTestability = "high" | "low";

export interface AcVerificationInput {
  /** The AC's AI-testability (per-AC lever input). */
  aiTestability: AiTestability;
  /** AI verification evidence present for this AC (e.g. verifier green). */
  hasAiEvidence: boolean;
  /** An explicit human verdict recorded for this AC. */
  hasHumanVerdict: boolean;
}

/**
 * Gate an AC's verification under the 3-input lever. AI evidence always passes. With no AI
 * evidence: a **low**-AI-testability AC passes on an explicit human verdict; a **high**
 * -AI-testability AC is refused — a human verdict cannot substitute for verification the AI
 * could have done (no-dodge guard).
 */
export function gateAcVerification(input: AcVerificationInput): GateResult {
  if (input.hasAiEvidence) return { ok: true };
  if (input.aiTestability === "low") {
    return input.hasHumanVerdict
      ? { ok: true }
      : {
          ok: false,
          reason:
            "Low-AI-testability AC needs an explicit human verdict — none recorded.",
        };
  }
  return {
    ok: false,
    reason:
      "High-AI-testability AC requires AI verification evidence; a human verdict does not substitute (no-dodge guard).",
  };
}
