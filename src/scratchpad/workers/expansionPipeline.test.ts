/**
 * Staged expansion pipeline (2026-07-18): prompt builders enforce the
 * elements-root model — stage 1 iterates the journal and sets servesEntry;
 * stages 2-4 iterate elements and demand a requires edge (orphan rule at
 * the source).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { WorkingModel } from "../model";
import {
  buildStagePrompt,
  EXPANSION_STAGES,
  journalEntries,
  liveElements,
} from "./expansionPipeline";

function seeded(): { model: WorkingModel; elementId: string } {
  let model = emptyModel("tep");
  model = reduce(model, { type: "seedGoal", text: "extend the graph" }).model;
  model = reduce(model, {
    type: "addRoughRequest",
    text: "harden verification",
  }).model;
  const elements = model.sections.find((s) => s.kind === "elements")!;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elements.id,
    item: { text: "auditor nodes", modality: "optional", evals: {}, servesEntry: 1 },
  }).model;
  const elementId = model.sections.find((s) => s.kind === "elements")!.items[0].id;
  return { model, elementId };
}

test("stages are elements → constraints → gap → acceptance", () => {
  assert.deepEqual(EXPANSION_STAGES, [
    "elements",
    "constraints",
    "gap",
    "acceptance",
  ]);
});

test("journal entries number the goal as entry 1", () => {
  const { model } = seeded();
  assert.deepEqual(journalEntries(model), [
    "extend the graph",
    "harden verification",
  ]);
});

test("stage 1 (elements) iterates the journal, demands servesEntry, targets only elements", () => {
  const { model } = seeded();
  const p = buildStagePrompt("elements", model);
  assert.ok(p.includes("STAGE 1"));
  assert.ok(p.includes("1. extend the graph"));
  assert.ok(p.includes("2. harden verification"));
  assert.ok(p.includes("servesEntry"));
  const elId = model.sections.find((s) => s.kind === "elements")!.id;
  assert.ok(p.includes(`Propose ONLY into the elements section ("${elId}")`));
});

test("stages 2-4 list the live elements and demand a requires edge (orphan rule)", () => {
  const { model, elementId } = seeded();
  for (const stage of ["constraints", "gap", "acceptance"] as const) {
    const p = buildStagePrompt(stage, model);
    assert.ok(p.includes(elementId), `${stage} must list the element id`);
    assert.ok(p.includes("auditor nodes"), `${stage} lists element text`);
    assert.ok(
      p.includes('"requires" edge'),
      `${stage} must demand a requires edge`,
    );
    assert.ok(p.includes("ORPHAN"), `${stage} states the orphan rule`);
  }
});

test("liveElements returns active elements with ids", () => {
  const { model, elementId } = seeded();
  assert.deepEqual(liveElements(model), [
    { id: elementId, text: "auditor nodes" },
  ]);
});
