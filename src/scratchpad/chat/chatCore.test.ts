/**
 * Tests for the @thinky chat core (Phase C, 2026-07-17): the chat surface is
 * a thin mouth over the session's one inbound seam — routing, slash-command
 * mapping, status rendering. No vscode; fakes only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { WorkingModel } from "../model";
import type { ScratchpadInboundMessage } from "../session";
import {
  handleThinkyRequest,
  renderThinkyStatus,
  THINKY_SLASH_COMMANDS,
  type ThinkySessionLike,
} from "./chatCore";

function fakeStream(): {
  markdowns: string[];
  buttons: { command: string; title: string; arguments?: unknown[] }[];
  markdown(v: string): void;
  button(b: { command: string; title: string; arguments?: unknown[] }): void;
} {
  const markdowns: string[] = [];
  const buttons: { command: string; title: string; arguments?: unknown[] }[] =
    [];
  return {
    markdowns,
    buttons,
    markdown(v: string) {
      markdowns.push(v);
    },
    button(b) {
      buttons.push(b);
    },
  };
}

function fakeSession(model: WorkingModel, outcome?: string) {
  const posted: ScratchpadInboundMessage[] = [];
  const session: ThinkySessionLike & { posted: ScratchpadInboundMessage[] } = {
    model,
    posted,
    lastCommandMessage: outcome,
    async postFromWebview(message: ScratchpadInboundMessage) {
      posted.push(message);
    },
  };
  return session;
}

test("no open session: thinky explains how to open one, posts nothing", async () => {
  const stream = fakeStream();
  await handleThinkyRequest({ prompt: "hello" }, undefined, stream);
  assert.equal(stream.markdowns.length, 1);
  assert.ok(stream.markdowns[0].includes("No thinking space is open"));
});

test("free text routes through the command seam verbatim", async () => {
  const session = fakeSession(
    emptyModel("tep"),
    "Recorded as standing assumption #1.",
  );
  const stream = fakeStream();
  await handleThinkyRequest(
    { prompt: "the environment is a single-user development platform" },
    session,
    stream,
  );
  assert.equal(session.posted.length, 1);
  assert.deepEqual(session.posted[0], {
    type: "command",
    utterance: "the environment is a single-user development platform",
  });
  assert.ok(stream.markdowns[0].includes("standing assumption"));
});

test("slash commands are exactly the phase acts — no contextualize, no panic", async () => {
  assert.equal(THINKY_SLASH_COMMANDS.expand, "expand");
  assert.equal(THINKY_SLASH_COMMANDS.scope, "scope context");
  assert.equal(THINKY_SLASH_COMMANDS.closegaps, "close gaps");
  assert.equal(THINKY_SLASH_COMMANDS.readiness, "check readiness");
  assert.equal(THINKY_SLASH_COMMANDS.reframe, "reframe");
  // contextualize is folded into expand; panic is a board-only destructive act.
  assert.equal(THINKY_SLASH_COMMANDS.contextualize, undefined);
  assert.equal(THINKY_SLASH_COMMANDS.panic, undefined);
  const session = fakeSession(emptyModel("tep"));
  const stream = fakeStream();
  await handleThinkyRequest(
    { prompt: "", command: "readiness" },
    session,
    stream,
  );
  assert.deepEqual(session.posted[0], {
    type: "command",
    utterance: "check readiness",
  });
});

test("empty prompt returns the status summary without posting", async () => {
  const session = fakeSession(emptyModel("tep"));
  const stream = fakeStream();
  await handleThinkyRequest({ prompt: "   " }, session, stream);
  assert.equal(session.posted.length, 0);
  assert.ok(stream.markdowns[0].includes("journal 1"));
});

test("status counts settled/active per section and shows the curated title", () => {
  let model = emptyModel("tep");
  const elements = model.sections.find((s) => s.kind === "elements")!;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elements.id,
    item: { text: "an element", modality: "optional", evals: {} },
  }).model;
  const itemId = model.sections.find((s) => s.kind === "elements")!.items[0].id;
  model = reduce(model, { type: "checkItem", actor: "human", itemId }).model;
  model = reduce(model, {
    type: "curateIntent",
    text: "- a commitment",
    title: "A short title",
  }).model;
  const status = renderThinkyStatus(model);
  assert.ok(status.includes("elements 1/1"));
  assert.ok(status.includes("A short title"));
});

test("a journalled but underived space offers EXPAND — never readiness", async () => {
  // A journal entry exists but nothing is derived yet: the only sensible act
  // is to expand. (Readiness over an underived space is the old noise.)
  const journalled = emptyModel("tep");
  journalled.sections.find((s) => s.kind === "goal")!.text = "build the graph";
  const session = fakeSession(journalled, "Link round done — 3 edges.");
  const stream = fakeStream();
  await handleThinkyRequest({ prompt: "link the space" }, session, stream);
  assert.equal(stream.markdowns[0], "Link round done — 3 edges.");
  const args = stream.buttons.map((b) => b.arguments?.[0]);
  assert.ok(args.includes("expand"), `expected expand, got ${args.join(", ")}`);
  assert.ok(
    !args.includes("check readiness"),
    "readiness must NOT be offered before anything is derived",
  );
});

test("staged selection switches the buttons to the apply verbs (field defect 2026-07-17)", async () => {
  const session = Object.assign(
    fakeSession(emptyModel("tep"), "5 items staged for action"),
    { selectionCount: 5 },
  );
  const stream = fakeStream();
  await handleThinkyRequest({ prompt: "select the elements" }, session, stream);
  assert.deepEqual(
    stream.buttons.map((b) => [b.command, b.arguments?.[0]]),
    [
      ["thinkube.thinky.applySelection", "check"],
      ["thinkube.thinky.applySelection", "defer"],
      ["thinkube.thinky.applySelection", "drop"],
      ["thinkube.thinky.say", "clear selection"],
    ],
  );
});

test("phase machine: settled-with-no-cut offers reframe (toCut), a cut offers readiness", async () => {
  const { phaseOf } = await import("./chatCore");
  let model = emptyModel("tep");
  const elements = model.sections.find((s) => s.kind === "elements")!;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elements.id,
    item: { text: "an element", modality: "optional", evals: {} },
  }).model;
  const itemId = model.sections.find((s) => s.kind === "elements")!.items[0].id;
  model = reduce(model, { type: "checkItem", actor: "human", itemId }).model;

  // Settled, no cut → toCut (reframe), NOT readiness.
  const session = fakeSession(model, "ok");
  assert.equal(phaseOf(session), "toCut");
  const stream = fakeStream();
  await handleThinkyRequest({ prompt: "anything" }, session, stream);
  assert.deepEqual(
    stream.buttons.map((b) => b.arguments?.[0]),
    ["reframe"],
  );

  // A cut makes readiness the meaningful act.
  const withCut = Object.assign(fakeSession(model, "ok"), { cutCount: 1 });
  assert.equal(phaseOf(withCut), "toCheckReadiness");
  const s2 = fakeStream();
  await handleThinkyRequest({ prompt: "anything" }, withCut, s2);
  assert.deepEqual(
    s2.buttons.map((b) => b.arguments?.[0]),
    ["check readiness"],
  );
});

test("phase machine: an empty journal is intake — no buttons at all", async () => {
  const { phaseOf } = await import("./chatCore");
  const bare = emptyModel("tep");
  bare.sections.find((s) => s.kind === "goal")!.text = "";
  const session = fakeSession(bare, "ok");
  assert.equal(phaseOf(session), "intake");
  const stream = fakeStream();
  await handleThinkyRequest({ prompt: "anything" }, session, stream);
  assert.equal(stream.buttons.length, 0, "typing is the act during intake");
});

test("phase machine: open gaps → close gaps; a pending decision → ratify first", async () => {
  const { phaseOf } = await import("./chatCore");
  let model = emptyModel("tep");
  const elSec = model.sections.find((s) => s.kind === "elements")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elSec,
    item: { text: "an element", modality: "optional", evals: {} },
  }).model;
  const gapSec = model.sections.find((s) => s.kind === "gap")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: gapSec,
    item: { text: "an open question", modality: "optional", evals: {} },
  }).model;
  assert.equal(phaseOf(fakeSession(model, "ok")), "toCloseGaps");

  const gapId = model.sections.find((s) => s.kind === "gap")!.items[0].id;
  model = reduce(model, {
    type: "proposeDecision",
    actor: "research",
    itemId: gapId,
    recommendation: "use X",
    reasoning: "because",
  }).model;
  assert.equal(phaseOf(fakeSession(model, "ok")), "toRatify");
});

// ── Session↔space binding (2026-07-17) ───────────────────────────────────────

test("session path round-trips nested namespaces", async () => {
  const { spaceToSessionPath, sessionPathToSpace } = await import("./chatCore");
  const path = spaceToSessionPath(
    "Platform/projects/plugin-delivery",
    "restart",
  );
  assert.equal(path, "/Platform/projects/plugin-delivery/restart");
  assert.deepEqual(sessionPathToSpace(path), {
    namespace: "Platform/projects/plugin-delivery",
    space: "restart",
  });
  assert.equal(sessionPathToSpace("/only-one-segment"), undefined);
  assert.equal(sessionPathToSpace(""), undefined);
});

test("boundSpaceFromChatContext reads the verified context shape, tolerates absence", async () => {
  const { boundSpaceFromChatContext } = await import("./chatCore");
  const bound = boundSpaceFromChatContext({
    chatSessionContext: {
      chatSessionItem: {
        resource: { path: "/Platform/projects/plugin-delivery/restart" },
      },
    },
  });
  assert.deepEqual(bound, {
    namespace: "Platform/projects/plugin-delivery",
    space: "restart",
  });
  assert.equal(boundSpaceFromChatContext(undefined), undefined);
  assert.equal(boundSpaceFromChatContext({}), undefined);
  assert.equal(
    boundSpaceFromChatContext({ chatSessionContext: { isUntitled: true } }),
    undefined,
  );
});
