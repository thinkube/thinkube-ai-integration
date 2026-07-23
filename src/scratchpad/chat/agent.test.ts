/**
 * Tests for the Thinky agent's pure core (2026-07-17): grounding snapshot,
 * doctrine prompt, and tool executors against a fake session. The SDK glue
 * is a guarded production thunk (not tested here).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { WorkingModel } from "../model";
import type { ScratchpadInboundMessage } from "../session";
import {
  buildThinkySystemPrompt,
  renderSpaceSnapshot,
  THINKY_TOOLS,
  type ThinkyAgentSessionLike,
} from "./agent";

function seeded(): { model: WorkingModel; elementId: string } {
  let model = emptyModel("tep");
  const elements = model.sections.find((s) => s.kind === "elements")!;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elements.id,
    item: { text: "the auth element", modality: "optional", evals: {} },
  }).model;
  const elementId = model.sections.find((s) => s.kind === "elements")!
    .items[0].id;
  model = reduce(model, {
    type: "checkItem",
    actor: "human",
    itemId: elementId,
  }).model;
  return { model, elementId };
}

function fakeSession(model: WorkingModel, outcome?: string) {
  const posted: ScratchpadInboundMessage[] = [];
  const dispatched: unknown[] = [];
  const session: ThinkyAgentSessionLike & {
    posted: ScratchpadInboundMessage[];
    dispatched: unknown[];
  } = {
    model,
    posted,
    dispatched,
    lastCommandMessage: outcome,
    selectionCount: 0,
    async postFromWebview(message: ScratchpadInboundMessage) {
      posted.push(message);
    },
    dispatch(action: unknown) {
      dispatched.push(action);
      const result = reduce(
        session.model,
        action as Parameters<typeof reduce>[1],
      );
      (session as { model: WorkingModel }).model = result.model;
      return result.delta;
    },
  };
  return session;
}

test("snapshot carries ids, settled marks, journal numbering, and staged count", () => {
  const { model, elementId } = seeded();
  const session = fakeSession(model);
  (session as { selectionCount: number }).selectionCount = 3;
  const snap = renderSpaceSnapshot(session);
  assert.ok(snap.includes(elementId));
  assert.ok(snap.includes("✓settled"));
  assert.ok(snap.includes("1. "));
  assert.ok(snap.includes("Staged for human action: 3"));
});

test("system prompt states human sovereignty and id discipline", () => {
  const prompt = buildThinkySystemPrompt();
  assert.ok(prompt.includes("HUMAN SOVEREIGNTY"));
  // Sovereignty is COMMANDING, not clicking (2026-07-23): the agent may apply
  // verbs, but only on an explicit order, and freeze/panic never.
  assert.ok(prompt.includes("COMMANDS, not that they click"));
  assert.ok(prompt.includes("ONLY on their explicit order"));
  assert.ok(prompt.includes("Freeze and panic are not yours"));
  assert.ok(prompt.includes("SELECT then ACT"));
  assert.ok(prompt.includes("Never invent item ids"));
});

test("cut_elements clears then toggles only valid ids, reports unknowns", async () => {
  const { model, elementId } = seeded();
  const session = fakeSession(model, "Cut: 1 element, 4 context items pulled.");
  const out = await THINKY_TOOLS.cut_elements.run(
    session,
    { itemIds: [elementId, "item-fake-99"] },
    { utterance: "" },
  );
  assert.deepEqual(session.posted[0], { type: "clearCut" });
  assert.deepEqual(session.posted[1], { type: "toggleCut", itemId: elementId });
  assert.equal(session.posted.length, 2);
  assert.ok(out.includes("Cut: 1 element"));
});

test("stage_items refuses when no valid ids and never posts", async () => {
  const { model } = seeded();
  const session = fakeSession(model);
  const out = await THINKY_TOOLS.stage_items.run(
    session,
    { itemIds: ["nope"] },
    { utterance: "" },
  );
  assert.equal(session.posted.length, 0);
  assert.ok(out.includes("Nothing staged"));
  assert.ok(out.includes("nope"));
});

test("stage_items stages valid ids through the selection channel", async () => {
  const { model, elementId } = seeded();
  const session = fakeSession(model);
  const out = await THINKY_TOOLS.stage_items.run(
    session,
    { itemIds: [elementId] },
    { utterance: "" },
  );
  assert.deepEqual(session.posted[0], { type: "clearSelection" });
  assert.deepEqual(session.posted[1], {
    type: "toggleSelect",
    itemId: elementId,
  });
  assert.ok(out.includes("Staged 1 item"));
  assert.ok(out.includes("human"));
});

test("assumption_verbatim: whole utterance when text omitted; paraphrase REJECTED", async () => {
  const { model } = seeded();
  const session = fakeSession(model);
  const rejected = await THINKY_TOOLS.assumption_verbatim.run(
    session,
    { text: "a paraphrase the model tried to sneak in" },
    { utterance: "single-user platform" },
  );
  assert.ok(rejected.includes("REJECTED"));
  assert.equal(session.model.assumptions?.length ?? 0, 0);
  const out = await THINKY_TOOLS.assumption_verbatim.run(
    session,
    {},
    { utterance: "single-user platform" },
  );
  assert.ok(out.includes("assumption #1"));
  assert.equal(session.model.assumptions?.[0].text, "single-user platform");
  const empty = await THINKY_TOOLS.assumption_verbatim.run(
    session,
    {},
    { utterance: "   " },
  );
  assert.ok(empty.includes("Nothing recorded"));
});

test("journal_verbatim: non-substring model text is REJECTED, omitted text records whole", async () => {
  const { model } = seeded();
  const session = fakeSession(model);
  const rejected = await THINKY_TOOLS.journal_verbatim.run(
    session,
    { text: "model words" },
    { utterance: "surface per-step log output in a node-anchored log panel" },
  );
  assert.ok(rejected.includes("REJECTED"));
  assert.equal(session.posted.length, 0);
  await THINKY_TOOLS.journal_verbatim.run(
    session,
    {},
    { utterance: "surface per-step log output in a node-anchored log panel" },
  );
  assert.deepEqual(session.posted[0], {
    type: "addRoughRequest",
    text: "surface per-step log output in a node-anchored log panel",
  });
});

test("expand_space triggers the decomposition round through the seam", async () => {
  const { model } = seeded();
  const session = fakeSession(model);
  await THINKY_TOOLS.expand_space.run(session, {}, { utterance: "go ahead" });
  assert.deepEqual(session.posted[0], { type: "prefill" });
});

test("the system prompt carries the guided-flow protocol", () => {
  const prompt = buildThinkySystemPrompt();
  assert.ok(prompt.includes("GUIDED FLOW"));
  assert.ok(prompt.includes("journal_verbatim"));
  assert.ok(prompt.includes("Never call it uninvited"));
});

test("the belt carries the item verbs but NEVER freeze or panic", () => {
  const names = Object.keys(THINKY_TOOLS);
  // Settling, deferring and dropping travel through ONE ordered verb tool, so
  // there is a single place where "did the human actually ask for this?"
  // is enforced.
  assert.ok(names.includes("apply_verb"));
  assert.ok(names.includes("select_items"));
  for (const forbidden of ["freeze", "panic"]) {
    assert.ok(
      !names.some((n) => n.includes(forbidden)),
      `belt must not contain ${forbidden} — those stay on the board`,
    );
  }
  assert.ok(
    THINKY_TOOLS.apply_verb.description.includes("NEVER call this uninvited"),
  );
});

test("readiness/reframe/research tools speak the exact seam messages", async () => {
  const { model } = seeded();
  const session = fakeSession(model, "outcome text");
  await THINKY_TOOLS.check_readiness.run(session, {}, { utterance: "" });
  await THINKY_TOOLS.reframe.run(session, {}, { utterance: "" });
  await THINKY_TOOLS.research.run(
    session,
    { subject: "digest storage" },
    { utterance: "" },
  );
  assert.deepEqual(
    session.posted.map((m) => m.type),
    ["checkReadiness", "reframe", "research"],
  );
  const research = session.posted[2] as { subject?: string };
  assert.equal(research.subject, "digest storage");
});

// ── Verbatim extraction (2026-07-17: wholesale capture fossilized wrappers) ──

test("extractVerbatim: whole message when no excerpt; exact substring accepted; rewrite rejected", async () => {
  const { extractVerbatim } = await import("./agent");
  const msg = "yes, add this: extend the graph with auditor nodes";
  assert.equal(extractVerbatim(msg, undefined), msg);
  assert.equal(
    extractVerbatim(msg, "extend the graph with auditor nodes"),
    "extend the graph with auditor nodes",
  );
  assert.equal(extractVerbatim(msg, "extend the graph with audit nodes"), null);
  // Whitespace differences are tolerated; wording differences are not.
  assert.equal(
    extractVerbatim("a  b\n c", "a b c"),
    "a b c",
  );
});

test("journal_verbatim records the validated excerpt and rejects rewrites", async () => {
  const { model } = seeded();
  const session = fakeSession(model);
  const out = await THINKY_TOOLS.journal_verbatim.run(
    session,
    { text: "extend the graph" },
    { utterance: "yes — extend the graph" },
  );
  assert.ok(!out.includes("REJECTED"), out);
  assert.deepEqual(session.posted[0], {
    type: "addRoughRequest",
    text: "extend the graph",
  });
  const rejected = await THINKY_TOOLS.journal_verbatim.run(
    session,
    { text: "a paraphrase of the ask" },
    { utterance: "yes — extend the graph" },
  );
  assert.ok(rejected.includes("REJECTED"));
  assert.equal(session.posted.length, 1);
});

test("splitJournalList: one entry per line, markers stripped, blanks dropped, words preserved", async () => {
  const { splitJournalList } = await import("./agent");
  const pasted =
    "- Harden the verification layer\n" +
    "* Add the missing safeguards\n" +
    "1. Resolve the open questions\n" +
    "2) Consolidate the defect ledger\n" +
    "   \n" +
    "[ ] a checkbox item\n" +
    "a plain line";
  assert.deepEqual(splitJournalList(pasted), [
    "Harden the verification layer",
    "Add the missing safeguards",
    "Resolve the open questions",
    "Consolidate the defect ledger",
    "a checkbox item",
    "a plain line",
  ]);
  // A single non-list message stays one entry.
  assert.deepEqual(splitJournalList("just one ask"), ["just one ask"]);
  assert.deepEqual(splitJournalList("  \n  "), []);
});

test("journal_list records one rough request per pasted line", async () => {
  const { model } = seeded();
  // seed a goal so entries land as rough requests, not the goal seed
  model.sections.find((s) => s.kind === "goal")!.text = "the goal";
  const session = fakeSession(model);
  const out = await THINKY_TOOLS.journal_list.run(
    session,
    {},
    { utterance: "- ask one\n- ask two\n- ask three" },
  );
  assert.deepEqual(
    session.posted.map((m) => (m as { text?: string }).text),
    ["ask one", "ask two", "ask three"],
  );
  assert.ok(out.includes("3 independent journal entries"));
});

test("snapshot names the declared context sources; doctrine forbids path-fishing", () => {
  const { model } = seeded();
  const session = Object.assign(fakeSession(model), {
    contextSources: ["/ws/root", "/store/Platform/projects/x"],
  });
  const snap = renderSpaceSnapshot(session);
  assert.ok(snap.includes("Declared context sources"));
  assert.ok(snap.includes("/store/Platform/projects/x"));
  const prompt = buildThinkySystemPrompt();
  assert.ok(prompt.includes("never ask for paths"));
  assert.ok(prompt.includes("scope_context"));
});

// ── Commanding the board (2026-07-23) ────────────────────────────────────────
// The human is the boss but does not click: they say what they want in their
// own words, the agent resolves it into an exact set, and only then acts.

/** An element with two constraints, one gap, and a second element's own
 *  constraint — enough to prove selection follows the real edges. */
function boardish(): {
  model: WorkingModel;
  elA: string;
  elB: string;
  conA: string;
  conB: string;
  gapA: string;
} {
  let model = emptyModel("tep");
  const push = (
    kind: "elements" | "constraints" | "gap",
    text: string,
    extra: Record<string, unknown>,
  ): string => {
    const sectionId = model.sections.find((s) => s.kind === kind)!.id;
    model = reduce(model, {
      type: "proposeItem",
      actor: "gap-filler",
      sectionId,
      item: { text, modality: "mandatory", evals: {}, ...extra },
    }).model;
    const items = model.sections.find((s) => s.kind === kind)!.items;
    return items[items.length - 1].id;
  };
  const elA = push("elements", "the log panel", { servesEntry: 1 });
  const elB = push("elements", "the graph view", { servesEntry: 2 });
  const conA = push("constraints", "docked in-graph", {
    servesEntry: 1,
    requires: [elA],
  });
  const conB = push("constraints", "nodes colour-coded", {
    servesEntry: 2,
    requires: [elB],
  });
  const gapA = push("gap", "which log levels?", {
    servesEntry: 1,
    requires: [conA],
  });
  return { model, elA, elB, conA, conB, gapA };
}

test("select_items resolves 'the constraints for the first element' by criteria", async () => {
  const { model, elA, conA, conB } = boardish();
  const session = fakeSession(model);
  const out = await THINKY_TOOLS.select_items.run(
    session,
    { kind: "constraints", relatedTo: elA },
    { utterance: "select the constraints for the first element" },
  );
  assert.deepEqual(session.posted[0], { type: "clearSelection" });
  const staged = session.posted
    .slice(1)
    .map((m) => (m as { itemId: string }).itemId);
  assert.deepEqual(staged, [conA], "only the first element's constraint");
  assert.ok(!staged.includes(conB));
  // The set is echoed back so the human sees it before ordering a verb.
  assert.ok(out.includes("Staged 1 item"));
  assert.ok(out.includes("docked in-graph"));
});

test("select_items pulls a whole ask's subtree by entry number", async () => {
  const { model, elA, conA, gapA } = boardish();
  const session = fakeSession(model);
  await THINKY_TOOLS.select_items.run(
    session,
    { servesEntry: 1 },
    { utterance: "select everything from my first ask" },
  );
  const staged = session.posted
    .slice(1)
    .map((m) => (m as { itemId: string }).itemId);
  assert.deepEqual(staged.sort(), [elA, conA, gapA].sort());
});

test("select_items with criteria that match nothing clears and says so", async () => {
  const { model } = boardish();
  const session = fakeSession(model);
  const out = await THINKY_TOOLS.select_items.run(
    session,
    { kind: "acceptance" },
    { utterance: "select the acceptance criteria" },
  );
  assert.deepEqual(session.posted, [{ type: "clearSelection" }]);
  assert.ok(out.includes("Nothing staged"));
});

test("apply_verb refuses with an empty selection and never posts", async () => {
  const { model } = boardish();
  const session = fakeSession(model);
  const out = await THINKY_TOOLS.apply_verb.run(
    session,
    { verb: "settle" },
    { utterance: "settle them" },
  );
  assert.equal(session.posted.length, 0);
  assert.ok(out.includes("Nothing is staged"));
});

test("apply_verb maps spoken verbs onto the board's own selection channel", async () => {
  const { model } = boardish();
  for (const [spoken, verb] of [
    ["settle", "check"],
    ["unsettle", "uncheck"],
    ["defer", "defer"],
    ["drop", "drop"],
  ] as const) {
    const session = fakeSession(model, "Applied.");
    (session as { selectionCount: number }).selectionCount = 2;
    await THINKY_TOOLS.apply_verb.run(
      session,
      { verb: spoken },
      { utterance: `${spoken} them` },
    );
    assert.deepEqual(session.posted, [{ type: "applySelection", verb }]);
  }
});

test("apply_verb rejects a verb that is not its to give", async () => {
  const { model } = boardish();
  const session = fakeSession(model);
  (session as { selectionCount: number }).selectionCount = 1;
  const out = await THINKY_TOOLS.apply_verb.run(
    session,
    { verb: "freeze" },
    { utterance: "freeze it" },
  );
  assert.equal(session.posted.length, 0);
  assert.ok(out.includes("Unknown verb"));
});

test("find_items is read-only", async () => {
  const { model, elA } = boardish();
  const session = fakeSession(model);
  const out = await THINKY_TOOLS.find_items.run(
    session,
    { relatedTo: elA },
    { utterance: "what belongs to the log panel?" },
  );
  assert.equal(session.posted.length, 0, "answering a question changes nothing");
  assert.ok(out.includes("3 item(s) match"));
});

test("inspect_item reports the reasoning the index only flags", async () => {
  const { model, conA, elA, gapA } = boardish();
  const noted = reduce(model, {
    type: "addItemNote",
    actor: "research",
    itemId: conA,
    text: "Impact — contradicted by journal entry 5.",
  }).model;
  const session = fakeSession(noted);
  const out = await THINKY_TOOLS.inspect_item.run(
    session,
    { itemId: conA },
    { utterance: "why does that constraint exist?" },
  );
  assert.ok(out.includes("docked in-graph"));
  assert.ok(out.includes("journal entry 1"));
  assert.ok(out.includes("contradicted by journal entry 5"));
  assert.ok(out.includes(elA), "names what it requires");
  assert.ok(out.includes(gapA), "names what requires it");
  const missing = await THINKY_TOOLS.inspect_item.run(
    session,
    { itemId: "item-nope" },
    { utterance: "" },
  );
  assert.ok(missing.includes("No item with id"));
});

// ── Revision as a conversation (2026-07-23) ─────────────────────────────────
// Drafting a new wording is free and reversible; only the commit is
// destructive, and it never happens without an explicit order.

function revisableSession(model: WorkingModel) {
  const base = fakeSession(model);
  let draft: { entry: number; text: string } | undefined;
  const calls: string[] = [];
  // A getter must be DEFINED, not assigned — Object.assign would copy the
  // value it has at wiring time (undefined) and never see a later draft.
  Object.defineProperty(base, "revisionDraft", {
    get: () => draft,
    configurable: true,
  });
  return Object.assign(base as typeof base & {
    revisionDraft?: { entry: number; text: string };
  }, {
    calls,
    stageRevision(entry: number, text: string) {
      calls.push(`stage:${entry}`);
      draft = { entry, text };
      return `Revising journal entry ${entry}: this DELETES 3 derived item(s).`;
    },
    async dryRunRevision() {
      calls.push("dryrun");
      return "Dry run: 1 surviving item would collide. Nothing has been changed.";
    },
    async applyRevision() {
      calls.push("apply");
      draft = undefined;
      return "Entry rewritten and re-derived.";
    },
    discardRevision() {
      calls.push("discard");
      draft = undefined;
      return "Revision draft discarded.";
    },
  });
}

test("propose_revision drafts without touching the space", async () => {
  const { model } = seeded();
  const session = revisableSession(model);
  const out = await THINKY_TOOLS.propose_revision.run(
    session,
    { entry: 2, text: "the log panel should be a separate window" },
    { utterance: "entry 2 is wrong, it should be a separate window" },
  );
  assert.deepEqual(session.calls, ["stage:2"]);
  assert.equal(session.posted.length, 0, "drafting posts nothing");
  assert.ok(out.includes("DELETES"));
  // A pending draft is visible in the grounding, so the next turn knows.
  assert.ok(renderSpaceSnapshot(session).includes("Revision drafted (NOT applied)"));
});

test("propose_revision refuses a bad entry number before drafting", async () => {
  const { model } = seeded();
  const session = revisableSession(model);
  const out = await THINKY_TOOLS.propose_revision.run(
    session,
    { entry: 0, text: "something" },
    { utterance: "" },
  );
  assert.deepEqual(session.calls, []);
  assert.ok(out.includes("journal entry number"));
});

test("test_revision reports consequences and changes nothing", async () => {
  const { model } = seeded();
  const session = revisableSession(model);
  const out = await THINKY_TOOLS.test_revision.run(session, {}, { utterance: "what would that break?" });
  assert.deepEqual(session.calls, ["dryrun"]);
  assert.ok(out.includes("Nothing has been changed"));
});

test("the destructive commit is a separate, explicitly-ordered act", async () => {
  const { model } = seeded();
  const session = revisableSession(model);
  await THINKY_TOOLS.propose_revision.run(
    session,
    { entry: 2, text: "a separate window" },
    { utterance: "" },
  );
  await THINKY_TOOLS.test_revision.run(session, {}, { utterance: "" });
  // Drafting and testing never commit on their own.
  assert.ok(!session.calls.includes("apply"));
  await THINKY_TOOLS.apply_revision.run(session, {}, { utterance: "yes, apply it" });
  assert.deepEqual(session.calls, ["stage:2", "dryrun", "apply"]);
  assert.equal(session.revisionDraft, undefined, "the draft is consumed");
});

test("discard_revision leaves the entry as it was", async () => {
  const { model } = seeded();
  const session = revisableSession(model);
  await THINKY_TOOLS.propose_revision.run(
    session,
    { entry: 2, text: "never mind" },
    { utterance: "" },
  );
  const out = await THINKY_TOOLS.discard_revision.run(session, {}, { utterance: "forget it" });
  assert.ok(out.includes("discarded"));
  assert.equal(session.revisionDraft, undefined);
});

test("revision tools degrade honestly on a surface that cannot revise", async () => {
  const { model } = seeded();
  const session = fakeSession(model); // no revision methods
  for (const name of ["propose_revision", "test_revision", "apply_revision", "discard_revision"]) {
    const out = await THINKY_TOOLS[name].run(
      session,
      { entry: 1, text: "x" },
      { utterance: "" },
    );
    assert.ok(out.includes("cannot"), `${name} should say it cannot`);
  }
});

test("the doctrine separates revising a wrong ask from journalling a new one", () => {
  const prompt = buildThinkySystemPrompt();
  assert.ok(prompt.includes("journal is a DRAFT, not an axiom"));
  assert.ok(prompt.includes("propose_revision"));
  assert.ok(prompt.includes("only on their order"));
  assert.ok(
    prompt.includes("never reach for it to add something"),
    "revision must not be used for additive asks",
  );
});
