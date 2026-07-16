/**
 * Unit tests for the action guide + normalization seam (field defect,
 * 2026-07-16): a worker emitted {"tool":"proposeItem","section":"Context",...}
 * — a shape it invented because the prompt disclosed neither the Action type
 * nor any sectionId — and the reducer's exhaustive switch threw "Unknown
 * action" into the UI, aborting the round mid-dispatch.
 *
 * Run via the repo recipe: compiled by tsconfig.test.json, executed with
 * `node --test` (node:test + node:assert, no framework).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { Action, WorkingModel } from "../model";
import {
  normalizeWorkerActions,
  renderActionGuide,
} from "./actionGuide";
import { GATES } from "./worker";

function modelWithItem(): { model: WorkingModel; itemId: string } {
  let model = emptyModel("tep");
  const constraints = model.sections.find((s) => s.kind === "constraints");
  assert.ok(constraints);
  const action: Action = {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: constraints.id,
    item: { text: "an existing item", modality: "optional", evals: {} },
  };
  const { model: next } = reduce(model, action);
  model = next;
  const itemId = model.sections.find((s) => s.kind === "constraints")!.items[0]
    .id;
  return { model, itemId };
}

// ── The exact payload from the field ─────────────────────────────────────────

test("the 2026-07-16 field payload is rejected with a readable reason, not a throw", () => {
  const model = emptyModel("tep");
  const fieldPayload = {
    tool: "proposeItem",
    section: "Context",
    text: "The orchestration graph currently does not include all steps — auditors and the closing gate node are missing from the visualization",
    checked: false,
    state: "active",
  };
  const { valid, rejected } = normalizeWorkerActions([fieldPayload], model, {
    defaultActor: "gap-filler",
    allowedTools: GATES.gapFiller.allowedTools,
  });
  // "Context" is not a real section kind — the action cannot be salvaged, but
  // it must land as a rejection with a reason instead of reaching the reducer.
  assert.equal(valid.length, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /unknown section/);
});

test("the same drifted shape with a REAL section kind is fully salvaged", () => {
  const model = emptyModel("tep");
  const { valid, rejected } = normalizeWorkerActions(
    [
      {
        tool: "proposeItem",
        section: "Constraints",
        text: "salvageable item",
        checked: false,
        state: "active",
      },
    ],
    model,
    {
      defaultActor: "gap-filler",
      allowedTools: GATES.gapFiller.allowedTools,
    },
  );
  assert.equal(rejected.length, 0);
  assert.equal(valid.length, 1);
  const a = valid[0];
  assert.equal(a.type, "proposeItem");
  if (a.type !== "proposeItem") return;
  assert.equal(a.actor, "gap-filler");
  assert.equal(
    a.sectionId,
    model.sections.find((s) => s.kind === "constraints")!.id,
  );
  assert.equal(a.item.text, "salvageable item");
  assert.equal(a.item.modality, "optional");
  // And the reducer applies it cleanly.
  const { delta } = reduce(model, a);
  assert.equal(delta.kind, "applied");
});

// ── Shape coercion details ────────────────────────────────────────────────────

test("a canonical well-formed action passes through unchanged", () => {
  const model = emptyModel("tep");
  const sectionId = model.sections.find((s) => s.kind === "elements")!.id;
  const canonical: Action = {
    type: "proposeItem",
    actor: "research",
    sectionId,
    item: { text: "canonical", modality: "mandatory", evals: { risk: 3 } },
  };
  const { valid, rejected } = normalizeWorkerActions([canonical], model, {
    defaultActor: "research",
    allowedTools: GATES.research.allowedTools,
  });
  assert.equal(rejected.length, 0);
  assert.deepEqual(valid[0], canonical);
});

test("gate enforcement: an out-of-gate action type is rejected", () => {
  const model = emptyModel("tep");
  const { valid, rejected } = normalizeWorkerActions(
    [{ type: "editGoal", text: "worker tries to rewrite the goal" }],
    model,
    {
      defaultActor: "gap-filler",
      allowedTools: GATES.gapFiller.allowedTools, // proposeItem, addItemNote only
    },
  );
  assert.equal(valid.length, 0);
  assert.match(rejected[0].reason, /outside this worker's gate/);
});

test("items cannot be proposed on the goal section", () => {
  const model = emptyModel("tep");
  const { valid, rejected } = normalizeWorkerActions(
    [{ type: "proposeItem", section: "goal", text: "sneaky goal item" }],
    model,
    {
      defaultActor: "gap-filler",
      allowedTools: GATES.gapFiller.allowedTools,
    },
  );
  assert.equal(valid.length, 0);
  assert.match(rejected[0].reason, /goal section/);
});

test("item-targeting actions resolve real item ids and reject invented ones", () => {
  const { model, itemId } = modelWithItem();
  const { valid, rejected } = normalizeWorkerActions(
    [
      { type: "addItemNote", itemId, text: "a note" },
      { type: "addItemNote", itemId: "item-invented-99", text: "ghost note" },
    ],
    model,
    {
      defaultActor: "integrator",
      allowedTools: GATES.integrator.allowedTools,
    },
  );
  assert.equal(valid.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /unknown item/);
});

test("attachEvidence fills a missing checkedAt from nowIso and applies", () => {
  const { model, itemId } = modelWithItem();
  const { valid, rejected } = normalizeWorkerActions(
    [
      {
        type: "attachEvidence",
        itemId,
        evidence: { source: "npm registry", method: "tk-package-version" },
      },
    ],
    model,
    {
      defaultActor: "research",
      allowedTools: GATES.research.allowedTools,
      nowIso: "2026-07-16T00:00:00.000Z",
    },
  );
  assert.equal(rejected.length, 0);
  const a = valid[0];
  assert.equal(a.type, "attachEvidence");
  if (a.type !== "attachEvidence") return;
  assert.equal(a.evidence.checkedAt, "2026-07-16T00:00:00.000Z");
  const { delta } = reduce(model, a);
  assert.equal(delta.kind, "applied");
});

test("non-object and typeless entries are rejected without throwing", () => {
  const model = emptyModel("tep");
  const { valid, rejected } = normalizeWorkerActions(
    ["just a string", null, { sectionId: "sec-1" }],
    model,
    {
      defaultActor: "gap-filler",
      allowedTools: GATES.gapFiller.allowedTools,
    },
  );
  assert.equal(valid.length, 0);
  assert.equal(rejected.length, 3);
});

// ── renderActionGuide ─────────────────────────────────────────────────────────

test("the guide discloses live sectionIds and the exact proposeItem shape", () => {
  const model = emptyModel("tep");
  const guide = renderActionGuide(
    model,
    GATES.gapFiller.allowedTools,
    "gap-filler",
  );
  // Every non-goal section id is disclosed verbatim.
  for (const sec of model.sections) {
    if (sec.kind === "goal") continue;
    assert.ok(guide.includes(`"${sec.id}"`), `guide missing ${sec.id}`);
  }
  // The worked example uses the canonical keys.
  assert.ok(guide.includes('"type":"proposeItem"'));
  assert.ok(guide.includes('"actor":"gap-filler"'));
  assert.ok(guide.includes('"sectionId"'));
  assert.ok(guide.includes('never "tool"'));
});

test("the reframe guide leaks no section/item IDs (editGoal takes none)", () => {
  const { model } = modelWithItem();
  const guide = renderActionGuide(model, ["editGoal"], "integrator");
  // reframe's contract: the prompt carries checked items only — the guide must
  // not re-introduce item texts or IDs the gate's tools never consume.
  assert.ok(!guide.includes("an existing item"));
  assert.ok(!guide.includes("Live sections"));
  assert.ok(!guide.includes("Live items"));
  assert.ok(guide.includes('"type":"editGoal"'));
});

test("guide + normalizer agree: items list appears iff an item-taking tool is allowed", () => {
  const { model } = modelWithItem();
  const researchGuide = renderActionGuide(
    model,
    GATES.research.allowedTools,
    "research",
  );
  assert.ok(researchGuide.includes("Live items"));
  assert.ok(researchGuide.includes("an existing item"));
});
