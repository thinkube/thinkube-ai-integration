/**
 * Pure view-model for the navigator Product tree (SP-tgvl81_SL-1 / TEP-tgvh8p).
 *
 * Groups the discovered repos under their Product and attaches each Product's
 * Projects. Pure (no vscode) so it's unit-testable; the navigator maps the
 * result to tree nodes and renders them. A repo belongs to a Product when the
 * first segment of its sidecar namespace equals the Product id; repos under no
 * Product fall into `ungroupedRepoPaths` (so nothing disappears).
 */
import type { Product } from "../../store/products";
import type { Project } from "../../store/projects";

export interface RepoRef {
  /** Absolute repo path (the key the navigator maps back to a RepoEntry). */
  path: string;
  /** The repo's sidecar namespace (`<container>/<rel>`), or undefined. */
  namespace?: string;
}

export interface ProjectDesc {
  product: string;
  id: string;
  name: string;
  state: "open" | "done";
  tag: string;
}

export interface ProductGroup {
  id: string;
  name: string;
  /** Member repo paths (subset of the input repos). */
  repoPaths: string[];
  projects: ProjectDesc[];
}

export interface ProductTree {
  products: ProductGroup[];
  /** Repo paths under no Product — still listed at top level. */
  ungroupedRepoPaths: string[];
}

export function buildProductTree(
  products: Product[],
  projects: Project[],
  repos: RepoRef[],
): ProductTree {
  const productIds = new Set(products.map((p) => p.id));

  const reposByProduct = new Map<string, string[]>();
  const ungroupedRepoPaths: string[] = [];
  for (const r of repos) {
    const seg = r.namespace ? r.namespace.split("/")[0] : undefined;
    if (seg && productIds.has(seg)) {
      const arr = reposByProduct.get(seg) ?? [];
      arr.push(r.path);
      reposByProduct.set(seg, arr);
    } else {
      ungroupedRepoPaths.push(r.path);
    }
  }

  const projectsByProduct = new Map<string, ProjectDesc[]>();
  for (const pr of projects) {
    const arr = projectsByProduct.get(pr.product) ?? [];
    arr.push({
      product: pr.product,
      id: pr.id,
      name: pr.name,
      state: pr.state,
      tag: pr.tag,
    });
    projectsByProduct.set(pr.product, arr);
  }

  return {
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      repoPaths: reposByProduct.get(p.id) ?? [],
      projects: projectsByProduct.get(p.id) ?? [],
    })),
    ungroupedRepoPaths,
  };
}
