/**
 * spaceManifest — the thinking space's card (`space.yaml`), TEP-14.
 *
 * The card is CONFIGURATION, never a name. A space's name is written exactly
 * one way everywhere — the workspace spelling (`Platform/core/thinkube-control`)
 * — and the card, sitting inside the space directory, declares two facts:
 *
 *   repo:
 *     remote: github.com/thinkube/thinkube-control   # the code repository
 *   orgs: [cmxela]                                    # the maintainers
 *
 * `repo.remote` lets every tool VERIFY that the directory it resolved really
 * is that repository before running anything against it (wrong clone / moved
 * directory / renamed repo → an error stating expected vs found). Project
 * spaces omit `repo:` entirely. `orgs` is the declared maintainer list —
 * TEP/SP numbering is scoped per (space, org); admitting a maintainer is one
 * reviewable line here, and a maintainer subtree on disk that is not declared
 * refuses loudly. The cross-maintainer reference grammar is deliberately a
 * future TEP.
 *
 * The card's presence is also the marker that a directory IS a thinking
 * space. Pure (string level); reading/walking lives in `spaceRegistry.ts`.
 */
import { parse as yamlParse } from "yaml";

/** The card filename — also the marker that a directory is a thinking space. */
export const SPACE_CARD_FILENAME = "space.yaml";

export interface SpaceCard {
  /** Declared maintainer segments (numbering scope per org). May be empty. */
  orgs: string[];
  /** Present iff the space is backed by a code repository. */
  repo?: { remote: string };
}

/** One path segment: letters, digits, dot, dash, underscore. */
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Normalize a git remote to the comparable `host/path` form:
 * `https://github.com/thinkube/x.git`, `ssh://git@github.com/thinkube/x` and
 * `git@github.com:thinkube/x.git` all become `github.com/thinkube/x`.
 * The host is lowercased (DNS is case-insensitive); the path keeps its case.
 */
export function normalizeRemote(remote: string): string {
  let r = remote.trim();
  r = r.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, ""); // scheme://
  r = r.replace(/^([^@/]+)@([^:/]+):/, "$2/"); // git@host:path → host/path
  r = r.replace(/^([^@/]+)@/, ""); // user@ left over from scheme form
  r = r.replace(/\.git$/, "").replace(/\/+$/, "");
  const slash = r.indexOf("/");
  if (slash === -1) return r.toLowerCase();
  return r.slice(0, slash).toLowerCase() + r.slice(slash);
}

/**
 * Parse + validate one card. `source` names the file in every error so a
 * refusal points at the offending card, never at a stack trace.
 */
export function parseSpaceCard(yamlText: string, source: string): SpaceCard {
  const fail = (msg: string): never => {
    throw new Error(`${source}: ${msg}`);
  };
  let raw: unknown;
  try {
    raw = yamlParse(yamlText);
  } catch (err) {
    return fail(`not valid YAML — ${(err as Error).message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return fail("the card must be a YAML mapping");
  const m = raw as Record<string, unknown>;

  const orgsRaw = m.orgs;
  if (!Array.isArray(orgsRaw) || orgsRaw.some((o) => typeof o !== "string"))
    return fail("`orgs` must be a list of maintainer segments (may be empty)");
  const orgs = (orgsRaw as string[]).map((o) => o.trim());
  if (orgs.some((o) => !SEGMENT.test(o)))
    return fail("`orgs` entries must be single path segments");
  if (new Set(orgs).size !== orgs.length)
    return fail("`orgs` entries must be unique");

  const repoRaw = m.repo as Record<string, unknown> | undefined;
  if (repoRaw === undefined) return { orgs };
  if (!repoRaw || typeof repoRaw !== "object" || Array.isArray(repoRaw))
    return fail("`repo` must be a mapping with a `remote`");
  const remote =
    typeof repoRaw.remote === "string" ? normalizeRemote(repoRaw.remote) : "";
  if (!remote)
    return fail("`repo.remote` is required when `repo` is present");
  return { orgs, repo: { remote } };
}
