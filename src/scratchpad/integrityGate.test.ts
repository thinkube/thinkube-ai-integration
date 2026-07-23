/**
 * Closing integrity gate (2026-07-18): orphan + coverage (deterministic) and
 * near-duplicate detection over the derived space.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "./model";
import type { Action, WorkingModel } from "./model";
import {
  computeIntegrity,
  integritySummary,
  unattributedNote,
} from "./integrityGate";
import { entriesOf, isAttributed } from "./model";

function apply(model: WorkingModel, action: Action): WorkingModel {
  const { model: next, delta } = reduce(model, action);
  assert.equal(delta.kind, "applied", JSON.stringify(delta));
  return next;
}
function propose(
  model: WorkingModel,
  kind: "elements" | "constraints" | "gap" | "acceptance",
  text: string,
  requires?: string[],
): { model: WorkingModel; id: string } {
  const sectionId = model.sections.find((s) => s.kind === kind)!.id;
  const next = apply(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId,
    item: { text, modality: "optional", evals: {}, ...(requires ? { requires } : {}) },
  });
  const items = next.sections.find((s) => s.kind === kind)!.items;
  return { model: next, id: items[items.length - 1].id };
}

test("a well-formed space (element + linked acceptance) is clean", () => {
  let { model, id: el } = propose(emptyModel("tep"), "elements", "an element");
  model = propose(model, "acceptance", "done when X", [el]).model;
  const r = computeIntegrity(model);
  assert.ok(r.clean, JSON.stringify(r));
  assert.ok(integritySummary(r).includes("clean"));
});

test("an unplaced constraint is REPORTED but never blocks the gate", () => {
  let { model, id: el } = propose(emptyModel("tep"), "elements", "an element");
  model = propose(model, "acceptance", "done when X", [el]).model;
  model = propose(model, "constraints", "a floating constraint").model; // no edge
  const r = computeIntegrity(model);
  assert.equal(r.unattributed.length, 1);
  assert.equal(r.unattributed[0].kind, "constraints");
  // The whole point (2026-07-23): the machine failed to place it, so the
  // machine owns it. The human is never asked to clear it to proceed.
  assert.ok(r.clean, "unattributed items do not make the report unclean");
  assert.match(unattributedNote(r) ?? "", /whole space/);
  assert.match(unattributedNote(r) ?? "", /Nothing is blocked/);
});

test("an unplaced item still serves every entry, so it is never homeless", () => {
  let { model } = propose(emptyModel("tep"), "elements", "an element");
  model = apply(model, { type: "addRoughRequest", text: "a second ask" });
  model = propose(model, "constraints", "a floating constraint").model;
  const floating = model.sections
    .find((s) => s.kind === "constraints")!
    .items[0];
  assert.deepEqual(entriesOf(model, floating), [1, 2]);
  assert.equal(isAttributed(floating), false);
});

test("an item stamped with an ask is placed, even with no element edge", () => {
  let { model, id: el } = propose(emptyModel("tep"), "elements", "an element");
  model = propose(model, "acceptance", "done when X", [el]).model;
  // A refinement-ask constraint with no edge but tagged servesEntry=2: belongs
  // to ask 2, so it is NOT an orphan (the ask is the anchor).
  const secId = model.sections.find((s) => s.kind === "constraints")!.id;
  model = apply(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: secId,
    item: { text: "hardening constraint from ask 2", modality: "optional", evals: {}, servesEntry: 2 },
  });
  const r = computeIntegrity(model);
  assert.equal(r.unattributed.length, 0, JSON.stringify(r.unattributed));
});

test("an element with no acceptance is uncovered", () => {
  const { model } = propose(emptyModel("tep"), "elements", "lonely element");
  const r = computeIntegrity(model);
  assert.equal(r.uncoveredElements.length, 1);
  assert.equal(r.uncoveredElements[0].text, "lonely element");
});

test("near-duplicate active items are surfaced as a pair", () => {
  let { model, id: el } = propose(emptyModel("tep"), "elements", "el");
  model = propose(
    model,
    "constraints",
    "the panel must page through output without leaving the graph view",
    [el],
  ).model;
  model = propose(
    model,
    "constraints",
    "the panel must page through output without leaving the graph screen",
    [el],
  ).model;
  const r = computeIntegrity(model);
  assert.equal(r.duplicates.length, 1);
});

test("transitive linkage (gap ← constraint ← element) is NOT an orphan", () => {
  let { model, id: el } = propose(emptyModel("tep"), "elements", "el");
  const c = propose(model, "constraints", "a constraint", [el]);
  model = c.model;
  model = propose(model, "gap", "an unknown", [c.id]).model;
  const r = computeIntegrity(model);
  assert.equal(r.unattributed.length, 0);
});
