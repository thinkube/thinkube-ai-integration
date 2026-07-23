/**
 * The IMPACT pass: a new journal entry added to an already-derived space must
 * surface what it CONTRADICTS/SUPERSEDES rather than silently coexisting with it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { WorkingModel } from "../model";
import { buildImpactPrompt, parseImpactReport } from "./impact";

function withItems(): { model: WorkingModel; elId: string; conId: string } {
  let model = emptyModel("tep");
  const elSec = model.sections.find((s) => s.kind === "elements")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elSec,
    item: { text: "the node-anchored log panel", modality: "mandatory", evals: {} },
  }).model;
  const elId = model.sections.find((s) => s.kind === "elements")!.items[0].id;
  const conSec = model.sections.find((s) => s.kind === "constraints")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "research",
    sectionId: conSec,
    item: {
      text: "The log panel is an in-graph docked panel",
      modality: "mandatory",
      evals: {},
      requires: [elId],
    },
  }).model;
  const conId = model.sections.find((s) => s.kind === "constraints")!.items[0].id;
  return { model, elId, conId };
}

test("prompt carries the new entry, the existing items, and forbids re-derivation", () => {
  const { model, conId } = withItems();
  const p = buildImpactPrompt(model, [
    { n: 5, text: "the log panel should be a separate window" },
  ]);
  assert.match(p, /separate window/);
  assert.ok(p.includes(conId), "lists the existing item ids");
  assert.match(p, /docked panel/);
  assert.match(p, /contradicted/);
  assert.match(p, /superseded/);
  assert.match(p, /do not re-derive/i);
  // Reporting nothing must be presented as the normal answer.
  assert.match(p, /reporting nothing is the normal, correct answer/i);
});

test("parse keeps valid findings, drops invented ids, bad kinds and duplicates", () => {
  const { model, conId } = withItems();
  const valid = new Set(
    model.sections.flatMap((s) => s.items.map((it) => it.id)),
  );
  const raw = `noise {"findings":[
    {"itemId":"${conId}","kind":"contradicted","why":"entry 5 makes it a separate window"},
    {"itemId":"${conId}","kind":"stale","why":"duplicate id — dropped"},
    {"itemId":"item-invented","kind":"contradicted","why":"not a real id"},
    {"itemId":"${conId}","kind":"nonsense","why":"bad kind"}
  ],"askConflicts":["conflicts with assumption: single-user platform"," "]} trailing`;
  const report = parseImpactReport(raw, valid);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].itemId, conId);
  assert.equal(report.findings[0].kind, "contradicted");
  assert.match(report.findings[0].why, /separate window/);
  assert.deepEqual(report.askConflicts, [
    "conflicts with assumption: single-user platform",
  ]);
});

test("parse is fail-soft on garbage — a new entry still lands", () => {
  assert.deepEqual(parseImpactReport("not json at all", new Set()), {
    findings: [],
    askConflicts: [],
    entryFindings: [],
  });
});

test("a worker may annotate an existing item with the collision reason", () => {
  const { model, conId } = withItems();
  const { model: noted, delta } = reduce(model, {
    type: "addItemNote",
    actor: "research",
    itemId: conId,
    text: "Impact — contradicted by journal entry 5: it asks for a separate window.",
  });
  assert.equal(delta.kind, "applied");
  const item = noted.sections
    .find((s) => s.kind === "constraints")!
    .items.find((it) => it.id === conId)!;
  assert.equal(item.notes.length, 1);
  assert.equal(item.notes[0].by, "research");
  assert.match(item.notes[0].text, /contradicted by journal entry 5/);
});

test("the prompt asks the round to accuse the ENTRY when the entry is at fault", () => {
  const { model } = withItems();
  const p = buildImpactPrompt(model, [{ n: 5, text: "make it nicer" }]);
  assert.match(p, /entryFindings/);
  assert.match(p, /underspecified/);
  assert.match(p, /suggestedText/);
  // The proposal is offered, never applied.
  assert.match(p, /never a rewrite you apply/);
  assert.match(p, /a workable ask is the normal case/);
});

test("entry findings are validated against the entries actually under review", () => {
  const { model, conId } = withItems();
  const valid = new Set(
    model.sections.flatMap((s) => s.items.map((it) => it.id)),
  );
  const raw = `{"findings":[],"askConflicts":[],"entryFindings":[
    {"entry":5,"kind":"underspecified","why":"no acceptance is derivable","suggestedText":"make the panel resizable"},
    {"entry":5,"kind":"underspecified","why":"duplicate entry — dropped"},
    {"entry":9,"kind":"underspecified","why":"not an entry under review"},
    {"entry":5,"kind":"vibes","why":"not a real kind"}
  ]}`;
  const report = parseImpactReport(raw, valid, new Set([5]));
  assert.equal(report.entryFindings.length, 1);
  assert.equal(report.entryFindings[0].entry, 5);
  assert.equal(report.entryFindings[0].suggestedText, "make the panel resizable");
  assert.equal(conId.length > 0, true);
});

test("an entry finding with no suggestion is still reported", () => {
  const report = parseImpactReport(
    `{"entryFindings":[{"entry":2,"kind":"self-contradictory","why":"asks for both"}]}`,
    new Set(),
    new Set([2]),
  );
  assert.equal(report.entryFindings.length, 1);
  assert.equal(report.entryFindings[0].suggestedText, undefined);
});
