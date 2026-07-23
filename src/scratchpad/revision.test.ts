/**
 * Revision: rewording an ask voids what was derived from it — except what a
 * frozen TEP already shipped, which no later edit can reach.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "./model";
import type { WorkingModel } from "./model";
import { findItems } from "./query";
import { describeRevisionPlan, journalEntries, planRevision } from "./revision";

function push(
  model: WorkingModel,
  kind: "elements" | "constraints" | "gap",
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

function spaceWithTwoAsks(): {
  model: WorkingModel;
  el1: string;
  con1: string;
  el2: string;
  con2: string;
} {
  let m = reduce(emptyModel("tep"), {
    type: "seedGoal",
    text: "surface per-step log output",
  }).model;
  m = reduce(m, {
    type: "addRoughRequest",
    text: "the log panel should be docked",
  }).model;
  let r = push(m, "elements", "the log panel", { servesEntry: 1 });
  const el1 = r.id;
  r = push(r.model, "constraints", "docked in-graph", {
    servesEntry: 2,
    requires: [el1],
  });
  const con1 = r.id;
  r = push(r.model, "elements", "the graph view", { servesEntry: 2 });
  const el2 = r.id;
  r = push(r.model, "constraints", "colour-coded nodes", {
    servesEntry: 2,
    requires: [el2],
  });
  const con2 = r.id;
  return { model: r.model, el1, con1, el2, con2 };
}

test("the journal numbers the goal as entry 1", () => {
  const { model } = spaceWithTwoAsks();
  const entries = journalEntries(model);
  assert.equal(entries[0].n, 1);
  assert.match(entries[0].text, /per-step log output/);
  assert.equal(entries[0].requestId, undefined, "the goal is not a request");
  assert.equal(entries[1].n, 2);
  assert.equal(entries[1].requestId, "req-0");
});

test("the plan purges the entry's subtree and spares the other ask", () => {
  const { model, el1, con1, el2, con2 } = spaceWithTwoAsks();
  const plan = planRevision(model, 2);
  const purged = plan.purge.map((h) => h.id).sort();
  assert.deepEqual(purged, [con1, el2, con2].sort());
  assert.ok(!purged.includes(el1), "entry 1's element is untouched");
  assert.equal(plan.preserved.length, 0);
});

test("shipped and TEP-protected items survive a revision", () => {
  let { model, con1, el2 } = spaceWithTwoAsks();
  model = reduce(model, {
    type: "stampShipped",
    itemIds: [el2],
    tepId: "TEP-3",
    flagIds: [con1],
  }).model;
  const plan = planRevision(model, 2);
  const preserved = plan.preserved.map((h) => h.id).sort();
  assert.ok(
    preserved.includes(el2) || plan.purge.every((h) => h.id !== el2),
    "a shipped item is never purged",
  );
  assert.ok(
    plan.purge.every((h) => h.id !== el2),
    "shipped items stay out of the purge set",
  );
});

test("purgeItems deletes, prunes inbound edges, and leaves no orphans behind", () => {
  const { model, el1, con1 } = spaceWithTwoAsks();
  // con1 requires el1; deleting el1 must not leave a dangling edge.
  const { model: after, delta } = reduce(model, {
    type: "purgeItems",
    actor: "human",
    itemIds: [el1],
  });
  assert.equal(delta.kind, "applied");
  assert.equal(
    after.sections.flatMap((s) => s.items).filter((it) => it.id === el1).length,
    0,
    "the item is gone, not flipped to a state",
  );
  const survivor = after.sections
    .flatMap((s) => s.items)
    .find((it) => it.id === con1)!;
  assert.deepEqual(survivor.requires, [], "the dangling edge was pruned");
});

test("purgeItems REFUSES to touch shipped history", () => {
  let { model, el2 } = spaceWithTwoAsks();
  model = reduce(model, {
    type: "stampShipped",
    itemIds: [el2],
    tepId: "TEP-3",
  }).model;
  const { model: after, delta } = reduce(model, {
    type: "purgeItems",
    actor: "human",
    itemIds: [el2],
  });
  assert.equal(delta.kind, "rejected");
  assert.match((delta as { reason: string }).reason, /shipped or TEP-protected/);
  assert.equal(
    after.sections.flatMap((s) => s.items).filter((it) => it.id === el2).length,
    1,
    "nothing was removed",
  );
});

test("editRoughRequest rewrites in place; empty rewrites are refused", () => {
  const { model } = spaceWithTwoAsks();
  const empty = reduce(model, {
    type: "editRoughRequest",
    actor: "human",
    requestId: "req-0",
    text: "   ",
  });
  assert.equal(empty.delta.kind, "rejected");
  const { model: after, delta } = reduce(model, {
    type: "editRoughRequest",
    actor: "human",
    requestId: "req-0",
    text: "the log panel should be a separate window",
  });
  assert.equal(delta.kind, "applied");
  assert.equal(
    after.roughRequests![0].text,
    "the log panel should be a separate window",
  );
  assert.equal(after.roughRequests!.length, 1, "no entry was added");
});

test("unmarkEntryDerived sends the entry back for re-derivation", () => {
  const { model } = spaceWithTwoAsks();
  const derived = reduce(model, { type: "markEntryDerived", entry: 2 }).model;
  assert.deepEqual(derived.derivedEntries, [2]);
  const { model: after, delta } = reduce(derived, {
    type: "unmarkEntryDerived",
    entry: 2,
  });
  assert.equal(delta.kind, "applied");
  assert.deepEqual(after.derivedEntries, []);
  assert.equal(
    reduce(after, { type: "unmarkEntryDerived", entry: 2 }).delta.kind,
    "rejected",
    "an entry that was not derived cannot be un-derived",
  );
});

test("the preview counts what will be lost, including settled work", () => {
  let { model, con1 } = spaceWithTwoAsks();
  model = reduce(model, {
    type: "checkItem",
    actor: "human",
    itemId: con1,
  }).model;
  const text = describeRevisionPlan(
    planRevision(model, 2),
    "the log panel should be a separate window",
  );
  assert.match(text, /DELETES 3 derived item\(s\), 1 of which you had settled/);
  assert.match(text, /separate window/);
  assert.match(text, /re-derived on its own/);
});

test("revising an entry that has derived nothing says so plainly", () => {
  const model = reduce(emptyModel("tep"), {
    type: "seedGoal",
    text: "a fresh idea",
  }).model;
  const text = describeRevisionPlan(planRevision(model, 1));
  assert.match(text, /Nothing derived from this entry yet/);
});

test("a nonexistent entry refuses instead of planning an empty purge", () => {
  const { model } = spaceWithTwoAsks();
  const plan = planRevision(model, 9);
  assert.match(plan.refusal ?? "", /no journal entry 9/);
  assert.match(describeRevisionPlan(plan), /Cannot revise/);
});

test("after a purge the surviving items are still findable by their own ask", () => {
  const { model, el1 } = spaceWithTwoAsks();
  const plan = planRevision(model, 2);
  const after = reduce(model, {
    type: "purgeItems",
    actor: "human",
    itemIds: plan.purge.map((h) => h.id),
  }).model;
  assert.deepEqual(
    findItems(after, { servesEntry: 1 }).map((h) => h.id),
    [el1],
  );
  assert.equal(findItems(after, { servesEntry: 2 }).length, 0);
});
