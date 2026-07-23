/**
 * Research anchoring (2026-07-23 field defect).
 *
 * Research proposed items with no ask anchor and no edge, so its findings
 * landed unplaced — six of them in the first field space. A round aimed at an
 * item already knows where its findings belong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce, entriesOf, isAttributed } from "../model";
import type { Action, WorkingModel } from "../model";
import { computeIntegrity } from "../integrityGate";
import { inheritAnchors, resolveTargetAnchors } from "./research";

function seeded(): { model: WorkingModel; gapId: string } {
  let model = reduce(emptyModel("tep"), {
    type: "seedGoal",
    text: "surface per-step log output",
  }).model;
  model = reduce(model, {
    type: "addRoughRequest",
    text: "colour-code the nodes",
  }).model;
  const gapSection = model.sections.find((s) => s.kind === "gap")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: gapSection,
    item: {
      text: "which log levels are shown?",
      modality: "mandatory",
      evals: {},
      servesEntries: [2],
    },
  }).model;
  return { model, gapId: model.sections.find((s) => s.kind === "gap")!.items[0].id };
}

function propose(model: WorkingModel, text: string): Action {
  return {
    type: "proposeItem",
    actor: "research",
    sectionId: model.sections.find((s) => s.kind === "constraints")!.id,
    item: { text, modality: "mandatory", evals: {} },
  };
}

test("a finding inherits the anchors of the item the round was aimed at", () => {
  const { model, gapId } = seeded();
  const anchors = resolveTargetAnchors(model, gapId);
  assert.deepEqual(anchors, { itemId: gapId, entries: [2] });
  const out = inheritAnchors(propose(model, "log levels are INFO and above"), anchors);
  assert.equal(out.type, "proposeItem");
  const item = (out as Extract<Action, { type: "proposeItem" }>).item;
  assert.deepEqual(item.servesEntries, [2]);
  assert.deepEqual(item.requires, [gapId], "and links back to what it answers");
});

test("the inherited anchor actually prevents the unplaced finding", () => {
  const { model, gapId } = seeded();
  const anchors = resolveTargetAnchors(model, gapId);
  const before = reduce(model, propose(model, "a floating finding")).model;
  const floating = before.sections.find((s) => s.kind === "constraints")!.items[0];
  assert.equal(isAttributed(floating), false);
  assert.equal(computeIntegrity(before).unattributed.length, 1, "the old behaviour");

  const after = reduce(
    model,
    inheritAnchors(propose(model, "a placed finding"), anchors),
  ).model;
  const placed = after.sections.find((s) => s.kind === "constraints")!.items[0];
  assert.ok(isAttributed(placed));
  assert.deepEqual(entriesOf(after, placed), [2]);
  assert.equal(computeIntegrity(after).unattributed.length, 0);
});

test("a free-subject round has no ask to inherit, and is left alone", () => {
  const { model } = seeded();
  assert.equal(resolveTargetAnchors(model, undefined), undefined);
  const action = propose(model, "a general finding");
  assert.deepEqual(inheritAnchors(action, undefined), action);
  // Unplaced, but by the fallback it serves the whole space — not homeless.
  const after = reduce(model, action).model;
  const it = after.sections.find((s) => s.kind === "constraints")!.items[0];
  assert.deepEqual(entriesOf(after, it), [1, 2]);
});

test("anchors the worker set itself are respected, and the edge is still added", () => {
  const { model, gapId } = seeded();
  const anchors = resolveTargetAnchors(model, gapId);
  const explicit = propose(model, "a finding the worker placed itself");
  (explicit as Extract<Action, { type: "proposeItem" }>).item.servesEntries = [1];
  const out = inheritAnchors(explicit, anchors);
  const item = (out as Extract<Action, { type: "proposeItem" }>).item;
  assert.deepEqual(item.servesEntries, [1], "not overwritten");
  assert.deepEqual(item.requires, [gapId]);
});

test("an unknown target id yields no anchors rather than a wrong one", () => {
  const { model } = seeded();
  assert.equal(resolveTargetAnchors(model, "item-nope"), undefined);
});

test("only proposeItem is rewritten — other actions pass through untouched", () => {
  const { model, gapId } = seeded();
  const anchors = resolveTargetAnchors(model, gapId);
  const note: Action = {
    type: "addItemNote",
    actor: "research",
    itemId: gapId,
    text: "a note",
  };
  assert.deepEqual(inheritAnchors(note, anchors), note);
});
