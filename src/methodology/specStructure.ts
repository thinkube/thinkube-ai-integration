/**
 * Spec structural check — the four canonical sections must be present.
 *
 * A Tandem Spec body is expected to carry four load-bearing sections, in any
 * order: Acceptance Criteria, Constraints, Design, and File Structure Plan.
 * Until now their presence was convention — `write_spec` accepted any body and
 * a Spec missing (say) its Constraints section sailed through. This module is
 * the pure core of the structural gate: `body → ok | { missing }`, with no I/O,
 * no store, and no `vscode`, so `write_spec` only has to call
 * {@link specSectionsPresent} and surface the named missing section.
 *
 * "Present" means a markdown heading at level ≤ 2 (`#` / `##`) whose title
 * matches the canonical name case-insensitively after stripping markdown
 * emphasis (`*`/`_`/`` ` ``) — the same heading-matching rule used by
 * `sectionPatch` and `specChange.normalizeRequirementSections`. Deeper (`###`+)
 * headings do not satisfy a canonical section, matching the boundary rule those
 * modules already enforce.
 *
 * Pure + dependency-free, so it is trivially testable and the handler + tests
 * agree on one exported contract.
 */

/**
 * The four canonical Spec section titles, in canonical (display) form. The
 * structural gate requires a heading matching each of these. Exported so the
 * handler and tests share one source of truth for the names.
 */
export const CANONICAL_SECTIONS: ReadonlyArray<string> = [
  "Acceptance Criteria",
  "Constraints",
  "Design",
  "File Structure Plan",
];

/**
 * Result of {@link specSectionsPresent}: either every canonical section is
 * present (`{ ok: true }`), or the first missing one is named (`{ ok: false,
 * missing }`). `missing` is the canonical display name (e.g. `"Constraints"`),
 * suitable for inclusion verbatim in the `write_spec` refusal message.
 */
export type SpecSectionsResult = { ok: true } | { ok: false; missing: string };

/** Normalize a heading title for matching: drop emphasis chars, trim, lowercase. */
function normalizeTitle(title: string): string {
  return title.replace(/[*_`]/g, "").trim().toLowerCase();
}

/**
 * Check that `body` contains all four {@link CANONICAL_SECTIONS} as level-≤2
 * markdown headings. Returns `{ ok: true }` when every canonical section is
 * present; otherwise `{ ok: false, missing }` naming the first canonical
 * section (in {@link CANONICAL_SECTIONS} order) that has no matching heading.
 *
 * Pure: depends only on `body`.
 */
export function specSectionsPresent(body: string): SpecSectionsResult {
  const present = new Set<string>();
  for (const raw of body.split(/\r?\n/)) {
    const heading = raw.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (!heading || heading[1].length > 2) continue;
    present.add(normalizeTitle(heading[2]));
  }

  for (const section of CANONICAL_SECTIONS) {
    if (!present.has(normalizeTitle(section))) {
      return { ok: false, missing: section };
    }
  }
  return { ok: true };
}
