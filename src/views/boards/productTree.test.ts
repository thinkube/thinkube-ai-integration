/**
 * Unit tests for the navigator Product-tree view-model (SP-tgvl81_SL-1).
 * Pure — literals only, no vscode/fs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildProductTree, RepoRef } from "./productTree";
import type { Product } from "../../store/products";
import type { Project } from "../../store/projects";

const products: Product[] = [
  { id: "Platform", name: "Thinkube Platform", members: [], },
  { id: "Apps", name: "Apps", members: [] },
];
const projects: Project[] = [
  {
    product: "Platform",
    id: "rebrand",
    name: "The Rebrand",
    state: "open",
    tag: "rebrand",
    manifestPath: "Platform/projects/rebrand/project.yaml",
  },
];
const repos: RepoRef[] = [
  { path: "/r/thinkube", namespace: "Platform/core/thinkube" },
  { path: "/r/control", namespace: "Platform/core/thinkube-control" },
  { path: "/r/app1", namespace: "Apps/app1" },
  { path: "/r/loose", namespace: undefined }, // no namespace → ungrouped
  { path: "/r/other", namespace: "Unknown/x" }, // no matching product → ungrouped
];

test("groups repos under their Product by namespace first segment", () => {
  const tree = buildProductTree(products, projects, repos);
  const platform = tree.products.find((p) => p.id === "Platform")!;
  assert.deepEqual(platform.repoPaths, ["/r/thinkube", "/r/control"]);
  assert.equal(platform.name, "Thinkube Platform");
  const apps = tree.products.find((p) => p.id === "Apps")!;
  assert.deepEqual(apps.repoPaths, ["/r/app1"]);
});

test("attaches each Product's projects", () => {
  const tree = buildProductTree(products, projects, repos);
  const platform = tree.products.find((p) => p.id === "Platform")!;
  assert.deepEqual(
    platform.projects.map((p) => `${p.id}:${p.tag}`),
    ["rebrand:rebrand"],
  );
  assert.deepEqual(tree.products.find((p) => p.id === "Apps")!.projects, []);
});

test("repos under no matching product are ungrouped (nothing disappears)", () => {
  const tree = buildProductTree(products, projects, repos);
  assert.deepEqual(tree.ungroupedRepoPaths, ["/r/loose", "/r/other"]);
});

test("no products → every repo is ungrouped", () => {
  const tree = buildProductTree([], [], repos);
  assert.equal(tree.products.length, 0);
  assert.equal(tree.ungroupedRepoPaths.length, repos.length);
});
