/**
 * Tests for the interpreter's two-selection contract (2026-07-16):
 *  - CHECKING (checkItem) is the settling act — it flows through as actions.
 *  - SELECTING stages items for a human-applied verb — destructive actions
 *    (drop/defer/supersede) are NEVER returned as actions; their targets come
 *    back as selectedItemIds, alongside the model's explicit "select" channel.
 * Run via the repo recipe (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { Action, WorkingModel } from "../model";
import { interpret } from "./interpreter";
import type { QueryFn, WorkerMessage } from "./worker";

function modelWithItems(n: number): { model: WorkingModel; ids: string[] } {
  let model = emptyModel("tep");
  const constraints = model.sections.find((s) => s.kind === "constraints")!;
  for (let i = 0; i < n; i++) {
    const a: Action = {
      type: "proposeItem",
      actor: "gap-filler",
      sectionId: constraints.id,
      item: { text: `item ${i}`, modality: "optional", evals: {} },
    };
    model = reduce(model, a).model;
  }
  const ids = model.sections
    .find((s) => s.kind === "constraints")!
    .items.map((it) => it.id);
  return { model, ids };
}

function fakeQuery(msg: WorkerMessage): () => QueryFn {
  return () =>
    async function* (_args): AsyncIterable<WorkerMessage> {
      yield msg;
    };
}

test("destructive actions from the model are converted to a selection, never applied", async () => {
  const { model, ids } = modelWithItems(3);
  const result = await interpret("drop the first two items", model, {
    loadQuery: fakeQuery({
      type: "actions",
      actions: [
        { type: "dropItem", actor: "human", itemId: ids[0] },
        { type: "dropItem", actor: "human", itemId: ids[1] },
      ] as Action[],
    }),
  });
  assert.deepEqual(result.actions, []);
  assert.deepEqual(new Set(result.selectedItemIds), new Set([ids[0], ids[1]]));
});

test("the select channel stages ids; invented ids are dropped; checkItem still settles directly", async () => {
  const { model, ids } = modelWithItems(2);
  const result = await interpret("accept item 0, select item 1", model, {
    loadQuery: fakeQuery({
      type: "actions",
      actions: [{ type: "checkItem", actor: "human", itemId: ids[0] }] as Action[],
      select: [ids[1], "item-invented-99"],
    }),
  });
  // Settling flows as an action.
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].type, "checkItem");
  // Staging carries only live ids.
  assert.deepEqual(result.selectedItemIds, [ids[1]]);
});

test("a pure selection round returns zero actions and the staged ids", async () => {
  const { model, ids } = modelWithItems(3);
  const result = await interpret("select the flavored items", model, {
    loadQuery: fakeQuery({
      type: "actions",
      actions: [],
      select: [ids[2]],
    }),
  });
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.selectedItemIds, [ids[2]]);
});

test("deterministic bulk expansion (accept all) still settles directly — it is the settling vocabulary", async () => {
  const { model, ids } = modelWithItems(2);
  const result = await interpret("accept all constraints", model, {
    // Bulk path never reaches the query — a throwing fake proves it.
    loadQuery: () =>
      async function* (): AsyncIterable<WorkerMessage> {
        throw new Error("query must not run for bulk expansion");
      },
  });
  assert.equal(result.actions.length, ids.length);
  assert.ok(result.actions.every((a) => a.type === "checkItem"));
  assert.equal(result.selectedItemIds, undefined);
});
