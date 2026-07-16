/**
 * Tests for the explainer worker (field request 2026-07-16): a per-item
 * Why/Impact/Modality note so the human can take an informed settle/defer/
 * drop decision. Run via the repo recipe (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { Action, WorkingModel } from "../model";
import { explainer, GATES } from "./worker";
import type { QueryFn, WorkerMessage } from "./worker";

function modelWithItem(): { model: WorkingModel; itemId: string } {
  let model = emptyModel("tep");
  model = reduce(model, { type: "seedGoal", text: "the intent" }).model;
  const constraints = model.sections.find((s) => s.kind === "constraints")!;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: constraints.id,
    item: { text: "the item to explain", modality: "mandatory", evals: {} },
  }).model;
  const itemId = model.sections.find((s) => s.kind === "constraints")!.items[0]
    .id;
  return { model, itemId };
}

test("explainer prompt carries the item, its modality, the note shape, and the exact-target pin", () => {
  const { model, itemId } = modelWithItem();
  const worker = explainer(
    { loadQuery: () => async function* (): AsyncIterable<WorkerMessage> {}, model: "sonnet" },
    itemId,
  );
  const prompt = worker.buildPrompt(model, []);
  assert.ok(prompt.includes("the item to explain"));
  assert.ok(prompt.includes("currently mandatory"));
  assert.ok(prompt.includes("Why:"));
  assert.ok(prompt.includes("Impact:"));
  assert.ok(prompt.includes("Modality:"));
  assert.ok(prompt.includes(`The ONLY itemId you may target is "${itemId}"`));
  // The gate is notes-only.
  assert.deepEqual(GATES.explainer.allowedTools, ["addItemNote"]);
});

test("explainer run normalizes the note and it applies to the model", async () => {
  const { model, itemId } = modelWithItem();
  const fake: () => QueryFn = () =>
    async function* (): AsyncIterable<WorkerMessage> {
      yield {
        type: "actions",
        actions: [
          {
            type: "addItemNote",
            itemId,
            text: "Why: it pins the boundary. Impact: without it scope drifts. Modality: mandatory is right — unsettled, the intent is undeliverable.",
          },
        ] as unknown as Action[],
      };
    };
  const worker = explainer({ loadQuery: fake, model: "sonnet" }, itemId);
  const actions = await worker.run(model, []);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "addItemNote");
  const { model: next, delta } = reduce(model, actions[0]);
  assert.equal(delta.kind, "applied");
  const notes = next.sections.find((s) => s.kind === "constraints")!.items[0]
    .notes;
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /Modality: mandatory is right/);
});

test("explainer run rejects an out-of-gate emission loudly (proposeItem is not a note)", async () => {
  const { model, itemId } = modelWithItem();
  const fake: () => QueryFn = () =>
    async function* (): AsyncIterable<WorkerMessage> {
      yield {
        type: "actions",
        actions: [
          {
            type: "proposeItem",
            sectionId: "sec-1",
            text: "sneaky proposal",
          },
        ] as unknown as Action[],
      };
    };
  const worker = explainer({ loadQuery: fake, model: "sonnet" }, itemId);
  await assert.rejects(() => worker.run(model, []), /all malformed/);
});
