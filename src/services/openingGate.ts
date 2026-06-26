// Opening AC-verifiability gate (SP-th1jtj / TEP-tgzx3p, the opening half — the closing half
// shipped in SP-tgzyfy). Pure, model-free core: the structural → Ready gate plus the helper
// that emits the per-AC `ac_verifications` map the closing gate consumes.
//
// Split of responsibility (see the Spec's constraints):
//   - The LLM auditor's `verifiable | needs-reframe` *judgment* runs inside `/spec-prepare`; a
//     `needs-reframe` AC simply gets no declaration.
//   - This module is the *structural* gate the server can run with no model: it enforces that
//     every AC ordinal 1..N carries a runnable `ac_verifications` entry. A missing/empty entry
//     (the footprint of a needs-reframe or undeclared AC) → blocked, naming the first ordinal.
//
// `emitAcVerifications` mirrors `kanbanMcpServer.ts`'s `normalizeAcVerifications` so the emitted
// map round-trips through the shipped closing gate's `parseAcVerifications`
// (`orchestratorCore.ts`) by construction — every AC present, no orphans.
//
// Re-audit on AC change (SP-th4wqf_SL-3 / TEP-th3i18 #2): the `ac_verifications` certification is
// keyed to a hash of the *Acceptance Criteria block* (`acRequirementHash`, a narrowing of the
// staleness `requirementHash` to that one section). When `/spec-prepare` certifies the ACs the
// handler stamps that hash under {@link AC_CERT_HASH_KEY}; a later edit to the AC block changes the
// hash, so `readyGate` (fed the spec's current vs. stamped hash) blocks the next `create_slice`
// until the ACs are re-certified. Editing *other* sections (Design / Constraints / File Structure
// Plan), or merely ticking an AC checkbox, leaves the hash — and the certification — intact.

// Import-only reuse of the closing gate's declaration shape — one serialization, both ends.
import type { AcVerification } from "./orchestratorCore";
// Re-audit reuses the staleness hash (SP-th1ddy rule: reuse, don't fork). `requirementHash`
// already normalizes checkbox state + whitespace; we feed it *only* the AC block to narrow it.
import { requirementHash } from "../methodology/specChange";

/** The auditor's per-AC certification (the model-side judgment from `/spec-prepare`). */
export type AcVerdictKind = "verifiable" | "needs-reframe";

/**
 * One AC's audit verdict. A `verifiable` verdict carries the concrete `{ run, env }` declaration;
 * a `needs-reframe` verdict carries `why` and no runnable command (so the structural gate blocks
 * it until it is reworked).
 */
export interface AcVerdict {
  /** 1-based AC ordinal this verdict covers. */
  ordinal: number;
  /** The auditor's call. */
  verdict: AcVerdictKind;
  /** The command that proves the AC — present (non-empty) only for `verifiable`. */
  run?: string;
  /** Where it runs — informational, mirrors `AcVerification.env`. */
  env?: "cluster" | "local";
  /** Why it can't be verified as written — present for `needs-reframe`. */
  why?: string;
}

/** The canonical `ac_verifications` frontmatter shape (AC ordinal → declaration). */
export type AcVerificationMap = Record<
  string,
  { run: string; env?: "cluster" | "local" }
>;

/**
 * `readyGate` result. Either Ready-eligible (`ok: true`) or blocked one of two ways:
 *   - **structural** — `{ ok: false, ordinal }` names the *first* AC ordinal with no runnable
 *     `ac_verifications` entry (an un-certified / needs-reframe AC).
 *   - **stale certification** — `{ ok: false, reason: "stale-certification" }` means every AC is
 *     structurally certified but against an *older* AC block: the ACs were edited since the
 *     certification was stamped, so re-certification is required (re-audit, AC3).
 *
 * The two are discriminated by the presence of `ordinal` vs. `reason`. The shell turns a block
 * into the refused → Ready transition with the matching diagnosis.
 */
export type ReadyGateResult =
  | { ok: true }
  | { ok: false; ordinal: number }
  | { ok: false; reason: "stale-certification" };

/** Frontmatter key under which the handler stamps {@link acRequirementHash} when the ACs are
 * certified (the `ac_verifications` map written). `readyGate` compares the spec's *current* AC-block
 * hash against this stamp to detect an AC edit that voided the certification. One symbol so the
 * `write_spec`/`patch_spec_section`/`create_slice` handlers and the dispatch test reference the
 * exact same field name. */
export const AC_CERT_HASH_KEY = "ac_verifications_hash";

/**
 * Captures the `## Acceptance Criteria` section body — from its heading to the next level-≤2
 * heading (a deeper `###` inside the section is kept as content). Mirrors
 * `kanbanMcpServer.ts`'s `acceptanceCriteriaOrdinals` regex so both read the same block.
 */
const AC_SECTION_RE =
  /(?:^|\n)##\s*Acceptance Criteria\s*\n([\s\S]*?)(?=\n##\s|$)/i;

/**
 * The certification key: a stable hash of just the Spec's **Acceptance Criteria block**. A
 * narrowing of the staleness `requirementHash` (which spans Acceptance Criteria / Design /
 * Constraints) down to the one section the `ac_verifications` map certifies — so editing the ACs
 * changes the hash (⇒ re-certify), while editing Design / Constraints / File Structure Plan, or
 * ticking an AC checkbox (collapsed by `normalizeRequirementSections`), does not.
 *
 * Re-feeds the extracted section *with its heading* to `requirementHash` so the existing
 * AC-only normalization applies verbatim — reuse, not a fork. A spec with no AC section hashes the
 * empty-normalization constant (stable), and a malformed certification can never match it.
 */
export function acRequirementHash(specBody: string | undefined): string {
  const body = specBody ?? "";
  const m = AC_SECTION_RE.exec(body);
  const section = m ? `## Acceptance Criteria\n${m[1]}` : "";
  return requirementHash(section);
}

/**
 * True iff the `ac_verifications` certification is **stale** — i.e. a baseline hash was stamped at
 * certification (`stampedHash` a non-empty string) and the Spec's `currentHash` no longer matches
 * it (the AC block was edited since). No stamp ⇒ not stale: a Spec certified before re-audit
 * shipped, or one with no certification at all, is left to the structural gate (mirrors
 * `classifySpecChange`'s "no baseline recorded → never flag").
 */
export function isAcCertificationStale(
  currentHash: string,
  stampedHash: unknown,
): boolean {
  if (typeof stampedHash !== "string" || !stampedHash) return false;
  return stampedHash !== currentHash;
}

/** True iff `decl` is a usable declaration — an object with a non-empty `run` string. */
function hasRunnableEntry(decl: unknown): decl is { run: string } {
  if (!decl || typeof decl !== "object") return false;
  const run = (decl as Record<string, unknown>).run;
  return typeof run === "string" && run.trim().length > 0;
}

/**
 * The structural → Ready gate (pure, model-free). Returns Ready-eligible **iff** every AC ordinal
 * carries a runnable `ac_verifications` entry; the first AC missing a declaration (or whose
 * declaration has no non-empty `run`) → `{ ok: false, ordinal }`. With no ACs the gate cannot
 * certify anything, so it blocks (there is nothing to be Ready *for*) — the bare AC-presence
 * check it replaces already refused an empty AC set.
 *
 * Ordinals are taken from `acs` (1-based, in document order) rather than assumed contiguous, so a
 * malformed AC list is judged by what it actually declares.
 *
 * Re-audit (AC3): when `certification` is supplied — the Spec's `currentHash` (from
 * {@link acRequirementHash}) and the `stampedHash` recorded under {@link AC_CERT_HASH_KEY} at
 * certification — a structurally-complete map is still refused as `{ ok: false, reason:
 * "stale-certification" }` if the AC block was edited since (the hashes diverge). The structural
 * check runs first, so an un-certified ordinal is still named precisely; the staleness check is the
 * fallback that fires when the map *looks* complete but certifies an outdated AC block. Omit
 * `certification` for the pure structural gate (the existing two-arg contract is unchanged).
 */
export function readyGate(
  acs: { ordinal: number }[],
  verifications: Record<string, { run: string; env?: "cluster" | "local" }>,
  certification?: { currentHash: string; stampedHash?: unknown },
): ReadyGateResult {
  if (!acs.length) return { ok: false, ordinal: 1 };
  const ordered = [...acs].sort((a, b) => a.ordinal - b.ordinal);
  for (const ac of ordered) {
    if (!hasRunnableEntry(verifications?.[String(ac.ordinal)])) {
      return { ok: false, ordinal: ac.ordinal };
    }
  }
  if (
    certification &&
    isAcCertificationStale(certification.currentHash, certification.stampedHash)
  ) {
    return { ok: false, reason: "stale-certification" };
  }
  return { ok: true };
}

/**
 * Map-emission helper: turn the auditor's verdicts into the canonical `ac_verifications` map the
 * Spec frontmatter carries. Only `verifiable` verdicts with a non-empty `run` and a positive
 * integer ordinal contribute an entry; `needs-reframe` verdicts emit nothing (so the gate blocks
 * them). Keys are sorted by ordinal for a stable, low-diff write. Mirrors
 * `kanbanMcpServer.ts`'s `normalizeAcVerifications` so the result round-trips through
 * `parseAcVerifications` — every emitted AC present, no orphans.
 */
export function emitAcVerifications(verdicts: AcVerdict[]): AcVerificationMap {
  const entries: [number, { run: string; env?: "cluster" | "local" }][] = [];
  for (const v of verdicts) {
    if (v.verdict !== "verifiable") continue;
    if (!Number.isInteger(v.ordinal) || v.ordinal <= 0) continue;
    if (typeof v.run !== "string" || !v.run.trim()) continue;
    entries.push([
      v.ordinal,
      {
        run: v.run.trim(),
        ...(v.env === "cluster" || v.env === "local" ? { env: v.env } : {}),
      },
    ]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  const out: AcVerificationMap = {};
  for (const [ordinal, decl] of entries) out[String(ordinal)] = decl;
  return out;
}

/** Re-export the closing gate's declaration type for callers wiring both ends. */
export type { AcVerification };
