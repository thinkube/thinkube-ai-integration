/**
 * `implementsPromoteCheck` (SP-th4wqe_SL-3 / issue #3) — the cross-thinking space promote
 * guard for `write_spec`'s `implements:`.
 *
 * Cross-thinking space learnability gap: a Spec may set `implements:` to a **qualified**
 * `<namespace>:TEP-<id>` ref (the umbrella membership link — see
 * `store/implementsRef.ts`). That only resolves cross-thinking space once the TEP has been
 * **promoted** into a project's `teps/` (a `<product>/projects/<name>` home — see
 * `store/projects.ts#projectTeps`). If the author qualifies an `implements:`
 * against a TEP that was never promoted, the membership link silently dangles.
 * This check refuses that write up front and points the author at the
 * `promote_tep` tool — the guidance IS the refusal (the spec's `docs: n/a`).
 *
 * Pure (no fs / vscode): the actual "does this TEP live at that namespace?"
 * lookup is injected as a {@link PromoteLocator}, so this is unit-testable
 * vscode-free and `write_spec` drives the real seam via `dispatchTool` with the
 * thinking space-backed locator. A **bare** (repo-local) ref is always accepted — there's
 * nothing cross-thinking space to promote. Only **qualified** refs consult the locator.
 */

import { parseImplements, type ParsedImplements } from "../store/implementsRef";

/** The MCP tool an author must run to promote a TEP — named in every refusal so
 *  the guidance is self-contained. */
export const PROMOTE_TOOL = "promote_tep";

/**
 * Injected lookup for whether a **qualified** `implements:` ref names an already
 * **promoted** (cross-thinking space reachable) TEP. Returns `true` when the TEP exists at
 * the ref's namespace (e.g. `projectTeps()` lists it under
 * `<product>/projects/<name>/teps/`), `false` when it does not (unpromoted /
 * dangling). May be sync or async — `write_spec` injects an fs-backed lookup.
 */
export type PromoteLocator = (
  ref: Required<Pick<ParsedImplements, "namespace">> & ParsedImplements,
) => boolean | Promise<boolean>;

/** A structured pointer to the remedy, surfaced on a refusal. */
export interface PromotePointer {
  /** The tool to run — always `promote_tep`. */
  tool: typeof PROMOTE_TOOL;
  /** The owning namespace the ref pointed at (the unpromoted target). */
  namespace: string;
  /** The bare TEP id (no `TEP-` prefix) that needs promoting. */
  tepId: string;
}

/** Result of the check: accept, or refuse with a `promote_tep` pointer + message. */
export type PromoteCheckResult =
  | { ok: true }
  | { ok: false; refuse: PromotePointer; message: string };

/**
 * Decide whether a Spec's `implements:` value may be written.
 *
 * - Absent / empty `implements:` → **ok** (nothing to link).
 * - **Bare** `TEP-<id>` (repo-local) → **ok** (resolves to the spec's own thinking space;
 *   no cross-thinking space promotion involved).
 * - **Qualified** `<namespace>:TEP-<id>` → consult `locator`:
 *     - promoted (`true`) → **ok**.
 *     - unpromoted (`false`) → **refuse**, with a message naming `promote_tep`.
 *
 * @param implementsRaw the raw `implements:` value being written (or undefined).
 * @param locator       injected promotion lookup for qualified refs.
 */
export async function implementsPromoteCheck(
  implementsRaw: string | undefined,
  locator: PromoteLocator,
): Promise<PromoteCheckResult> {
  const ref = parseImplements(implementsRaw);
  // No ref, or a bare (repo-local) ref → nothing cross-thinking space to promote.
  if (!ref || !ref.namespace) return { ok: true };

  const qualified = ref as ParsedImplements & { namespace: string };
  const promoted = await locator(qualified);
  if (promoted) return { ok: true };

  const namespace = qualified.namespace;
  const tepId = qualified.id;
  return {
    ok: false,
    refuse: { tool: PROMOTE_TOOL, namespace, tepId },
    message:
      `implements: "${implementsRaw?.trim()}" names the cross-thinking space TEP ` +
      `${namespace}:TEP-${tepId}, which has not been promoted into a project. ` +
      `A qualified (umbrella) ref only resolves once its TEP lives in a ` +
      `project's teps/. Promote it first with the ${PROMOTE_TOOL} tool ` +
      `(it moves the TEP into the project and rewrites dependents), then retry ` +
      `write_spec with the same ref.`,
  };
}
