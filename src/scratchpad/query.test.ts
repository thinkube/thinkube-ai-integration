/**
 * The query engine: criteria resolve EXACTLY, and "related to" follows the
 * requires graph with elements as sinks (so an element's private context is
 * its own, and a shared item belongs to every element it serves).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "./model";
import type { WorkingModel } from "./model";
import { findItems, anchorElementsFor, indexItems, buildAdjacency } from "./query";

function add(
  model: WorkingModel,
  kind: "elements" | "constraints" | "gap" | "acceptance",
  text: string,
  extra: Record<string, unknown> = {},
): { model: WorkingModel; id: string } {
  const sectionId = model.sections.find((s) => s.kind === kind)!.id;
  const next = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId,
    item: { text, modality: "mandatory", evals: {}, ...extra },
  }).model;
  const items = next.sections.find((s) => s.kind === kind)!.items;
  return { model: next, id: items[items.length - 1].id };
}

/** Two elements from two different asks, each with its own constraint, plus
 *  one constraint shared by both. */
function fixture(): {
  model: WorkingModel;
  elA: string;
  elB: string;
  conA: string;
  conB: string;
  shared: string;
  gapA: string;
} {
  let m = emptyModel("tep");
  let r = add(m, "elements", "the log panel", { servesEntry: 1 });
  const elA = r.id;
  r = add(r.model, "elements", "the graph view", { servesEntry: 2 });
  const elB = r.id;
  r = add(r.model, "constraints", "the panel is docked in-graph", {
    servesEntry: 1,
    requires: [elA],
  });
  const conA = r.id;
  r = add(r.model, "constraints", "nodes are colour-coded by kind", {
    servesEntry: 2,
    requires: [elB],
  });
  const conB = r.id;
  r = add(r.model, "constraints", "everything renders in the VS Code theme", {
    servesEntry: 1,
    requires: [elA, elB],
  });
  const shared = r.id;
  r = add(r.model, "gap", "which log levels are shown?", {
    servesEntry: 1,
    requires: [conA],
  });
  const gapA = r.id;
  return { model: r.model, elA, elB, conA, conB, shared, gapA };
}

test("relatedTo on an element gathers its constraints, not the other ask's", () => {
  const { model, elA, conA, shared, conB } = fixture();
  const ids = findItems(model, { kind: "constraints", relatedTo: elA }).map(
    (h) => h.id,
  );
  assert.deepEqual(ids.sort(), [conA, shared].sort());
  assert.ok(!ids.includes(conB), "the other element's constraint is excluded");
});

test("relatedTo reaches transitively — a gap hanging off a constraint", () => {
  const { model, elA, gapA } = fixture();
  const ids = findItems(model, { relatedTo: elA }).map((h) => h.id);
  assert.ok(
    ids.includes(gapA),
    "a gap two hops from the element still belongs to it",
  );
  assert.ok(ids.includes(elA), "the element belongs to its own relation");
});

test("elements are sinks — the two asks do not bleed into each other", () => {
  const { model, elA, elB, conB } = fixture();
  const byId = indexItems(model);
  const adj = buildAdjacency(byId);
  // conB anchors ONLY to elB even though `shared` touches both elements:
  // traversal stops at every element it meets.
  assert.deepEqual(anchorElementsFor(byId, adj, conB), [elB]);
  assert.deepEqual(anchorElementsFor(byId, adj, elA), [elA]);
});

test("a shared item belongs to BOTH elements", () => {
  const { model, elA, elB, shared } = fixture();
  const byId = indexItems(model);
  const adj = buildAdjacency(byId);
  assert.deepEqual(
    anchorElementsFor(byId, adj, shared).sort(),
    [elA, elB].sort(),
  );
  for (const el of [elA, elB])
    assert.ok(
      findItems(model, { relatedTo: el }).some((h) => h.id === shared),
      "shared context is returned for either element",
    );
});

test("attribute criteria combine with AND", () => {
  const { model, elA, conA } = fixture();
  assert.deepEqual(
    findItems(model, {
      kind: "constraints",
      relatedTo: elA,
      textMatches: "DOCKED",
    }).map((h) => h.id),
    [conA],
    "text match is case-insensitive and intersects the relation",
  );
  assert.equal(
    findItems(model, { servesEntry: 2, kind: "gap" }).length,
    0,
    "entry 2 has no gaps",
  );
});

test("settled filters on the checkbox, and defaults to active items only", () => {
  const { model, conA } = fixture();
  assert.equal(findItems(model, { settled: true }).length, 0);
  const checked = reduce(model, {
    type: "checkItem",
    actor: "human",
    itemId: conA,
  }).model;
  assert.deepEqual(
    findItems(checked, { settled: true }).map((h) => h.id),
    [conA],
  );
  const dropped = reduce(checked, {
    type: "dropItem",
    actor: "human",
    itemId: conA,
  }).model;
  assert.equal(
    findItems(dropped, { settled: true }).length,
    0,
    "dropped items are out unless state is asked for explicitly",
  );
  assert.equal(findItems(dropped, { state: "any", settled: true }).length, 1);
});

test("an unknown relatedTo id returns nothing rather than everything", () => {
  const { model } = fixture();
  assert.deepEqual(findItems(model, { relatedTo: "item-nope" }), []);
});

test("the goal section never appears in results", () => {
  const { model } = fixture();
  assert.ok(findItems(model, { state: "any" }).every((h) => h.kind !== "goal"));
});
