/**
 * SP-21/2 AC-7 — The panel's authoring controls are wired end-to-end.
 *
 * WHY (INVARIANT): Every authoring control the panel offers — the Goal input,
 * per-section edit, per-section add-note, and "Ask for structure" — sends its
 * own enumerated message over the webview channel, and the session applies each
 * message through the one reducer: a message arriving on the channel produces
 * the SAME model change and the SAME render as the equivalent programmatic action.
 * This must hold forever; any implementation that bypasses the reducer for a
 * particular message type, or that wires the wrong action type to a control,
 * breaks this test.
 *
 * Two sessions driven in parallel:
 *   Session A — driven via postFromWebview (the real inbound path).
 *   Session B — driven via dispatch / askForStructure (the programmatic reference).
 * After each message, A's model must deep-equal B's model, and A's renderedHtml()
 * must equal B's renderedHtml().
 *
 * The rendered HTML is also checked for the control elements the spec contract
 * requires: #goal-input, per-section .edit-section and .add-note with
 * data-section-id, and #ask-structure.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";
import type {
  ScratchpadSession,
  ScratchpadSessionDeps,
} from "../scratchpad/session";
import type { QueryFn, WorkerMessage } from "../scratchpad/workers/worker";

// ── Round-2 protocol additions ─────────────────────────────────────────────────
// Verbatim from the SPEC CONTRACT; will be exported from session.ts once built.
type ScratchpadInboundMessage =
  | { type: "seedGoal"; text: string }
  | { type: "editGoal"; text: string }
  | { type: "editSection"; id: string; text: string }
  | { type: "addNote"; sectionId: string; text: string }
  | { type: "askStructure" };

type WithPostFromWebview = ScratchpadSession & {
  /** The panel's real inbound path — same function the webview channel's
   *  onDidReceiveMessage calls (SPEC CONTRACT). */
  postFromWebview(message: ScratchpadInboundMessage): Promise<void>;
};

// ── Marker strings ──────────────────────────────────────────────────────────────
const MARKER_SEEDGOAL = "SEEDGOALCTRLMARKER";
const MARKER_EDITGOAL = "EDITGOALCTRLMARKER";
const MARKER_EDITSECTION = "EDITSECTIONCTRLMARKER";
const MARKER_NOTE = "ADDNOTECTRLMARKER";
const MARKER_PROPOSAL = "ASKSTRUCTURECTRLMARKER";

// ── Fake worker query ───────────────────────────────────────────────────────────
// Injected into BOTH sessions so the worker round (askStructure / askForStructure)
// yields the same deterministic proposal on each.
function makeFakeLoadQuery(): () => QueryFn {
  return (): QueryFn =>
    async function* (_args) {
      const msg: WorkerMessage = {
        type: "actions",
        actions: [
          {
            type: "proposeSection",
            kind: "constraints",
            text: MARKER_PROPOSAL,
            workerId: "fake-gap-filler",
          },
        ],
      };
      yield msg;
    };
}

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  const tmpDirA = path.join(os.tmpdir(), "tandem-probe-sp21-2-ac7-A");
  const tmpDirB = path.join(os.tmpdir(), "tandem-probe-sp21-2-ac7-B");
  fs.rmSync(tmpDirA, { recursive: true, force: true });
  fs.mkdirSync(tmpDirA, { recursive: true });
  fs.rmSync(tmpDirB, { recursive: true, force: true });
  fs.mkdirSync(tmpDirB, { recursive: true });

  const sharedDeps: ScratchpadSessionDeps = {
    loadQuery: makeFakeLoadQuery(),
  };

  // Open session A first (postFromWebview driver), then session B (dispatch reference).
  // Both start from emptyModel("tep") — clean tmp dirs, no current.json.
  const rawA = await api.scratchpad.openScratchpad({
    ...sharedDeps,
    sidecarRoot: tmpDirA,
  });
  const rawB = await api.scratchpad.openScratchpad({
    ...sharedDeps,
    sidecarRoot: tmpDirB,
  });

  assert.ok(rawA, "session A must be returned by openScratchpad");
  assert.ok(rawB, "session B must be returned by openScratchpad");

  const sessionA = rawA as unknown as WithPostFromWebview;
  const sessionB = rawB;

  assert.equal(
    typeof sessionA.postFromWebview,
    "function",
    "session must expose postFromWebview — the round-2 inbound path must be present",
  );

  // ── Helper: assert model + render equivalence after each step ─────────────
  function assertEquivalent(stepLabel: string): void {
    assert.deepStrictEqual(
      sessionA.model,
      sessionB.model,
      `[${stepLabel}] session A's model (via postFromWebview) must deep-equal ` +
        "session B's model (via programmatic dispatch) — same reducer path",
    );
    assert.equal(
      sessionA.renderedHtml(),
      sessionB.renderedHtml(),
      `[${stepLabel}] session A's renderedHtml() must equal session B's — ` +
        "same model + same deltas → same render",
    );
  }

  // ── 1. seedGoal ────────────────────────────────────────────────────────────
  // WHY (INVARIANT): the Goal input's confirm posts { type:"seedGoal", text }
  // and the session dispatches seedGoal — seeding the goal section with the typed
  // text and transitioning the model to phase "shaping".
  await sessionA.postFromWebview({ type: "seedGoal", text: MARKER_SEEDGOAL });
  sessionB.dispatch({ type: "seedGoal", text: MARKER_SEEDGOAL });

  assertEquivalent("seedGoal");

  assert.equal(
    sessionA.model.phase,
    "shaping",
    "seedGoal via postFromWebview must transition model.phase to 'shaping'",
  );

  const goalSection = sessionA.model.sections.find((s) => s.kind === "goal");
  assert.ok(goalSection, "a goal section must exist after seedGoal");
  const goalIdA = goalSection.id;
  const goalIdB = sessionB.model.sections.find((s) => s.kind === "goal")!.id;

  // ── 2. editGoal ────────────────────────────────────────────────────────────
  // WHY (INVARIANT): when the goal section already has text, the Goal input's
  // confirm posts { type:"editGoal", text } (not seedGoal) — updating the goal
  // text without changing the model phase.
  await sessionA.postFromWebview({ type: "editGoal", text: MARKER_EDITGOAL });
  sessionB.dispatch({ type: "editGoal", text: MARKER_EDITGOAL });

  assertEquivalent("editGoal");

  const goalAfterEdit = sessionA.model.sections.find((s) => s.kind === "goal");
  assert.equal(
    goalAfterEdit?.text,
    MARKER_EDITGOAL,
    "editGoal via postFromWebview must update the goal section's text",
  );

  // ── 3. editSection ─────────────────────────────────────────────────────────
  // WHY (INVARIANT): each section's edit control posts { type:"editSection",
  // id, text } — updating the section's text through the one reducer.
  await sessionA.postFromWebview({
    type: "editSection",
    id: goalIdA,
    text: MARKER_EDITSECTION,
  });
  sessionB.dispatch({
    type: "editSection",
    id: goalIdB,
    text: MARKER_EDITSECTION,
  });

  assertEquivalent("editSection");

  const goalAfterSection = sessionA.model.sections.find(
    (s) => s.kind === "goal",
  );
  assert.equal(
    goalAfterSection?.text,
    MARKER_EDITSECTION,
    "editSection via postFromWebview must update the section's text",
  );

  // ── 4. addNote ─────────────────────────────────────────────────────────────
  // WHY (INVARIANT): each section's add-note control posts { type:"addNote",
  // sectionId, text } — appending the note to the section through the one reducer.
  await sessionA.postFromWebview({
    type: "addNote",
    sectionId: goalIdA,
    text: MARKER_NOTE,
  });
  sessionB.dispatch({
    type: "addNote",
    sectionId: goalIdB,
    text: MARKER_NOTE,
  });

  assertEquivalent("addNote");

  const goalWithNote = sessionA.model.sections.find((s) => s.kind === "goal");
  assert.equal(
    goalWithNote?.notes.length,
    1,
    "addNote via postFromWebview must append one note to the section",
  );
  assert.equal(
    goalWithNote?.notes[0].text,
    MARKER_NOTE,
    "the appended note must carry the text posted via addNote",
  );

  // ── 5. askStructure ────────────────────────────────────────────────────────
  // WHY (INVARIANT): the "Ask for structure" button posts { type:"askStructure" }
  // which maps to session.askForStructure() — the gap-filling worker runs and
  // its proposed sections land through dispatch into the one reducer.
  await sessionA.postFromWebview({ type: "askStructure" });
  await sessionB.askForStructure();

  assertEquivalent("askStructure");

  const proposedA = sessionA.model.sections.find(
    (s) => s.kind === "constraints",
  );
  assert.ok(
    proposedA,
    "askStructure via postFromWebview must result in the worker's proposed section appearing in the model",
  );
  assert.equal(
    proposedA.text,
    MARKER_PROPOSAL,
    "the proposed section's text must match what the fake worker yielded",
  );
  assert.ok(
    sessionA.renderedHtml().includes(MARKER_PROPOSAL),
    `renderedHtml() must contain '${MARKER_PROPOSAL}' after askStructure — ` +
      "the worker's proposed section must be visible in the panel",
  );

  // ── HTML controls: the rendered panel must carry every wired control ────────
  //
  // WHY (INVARIANT): the spec contract mandates that renderedHtml() contains
  // each of these elements with the named ids/classes/attributes so that the
  // webview JavaScript can wire each control to its corresponding message type.
  // An implementation that omits any control renders the authoring surface
  // non-functional for the person.
  const html = sessionA.renderedHtml();

  // The Goal input — a textarea with id "goal-input".
  assert.ok(
    /id\s*=\s*["']goal-input["']/.test(html),
    'renderedHtml() must contain an element with id="goal-input" — ' +
      "the Goal area where the person types their draft",
  );

  // Per-section edit controls — class "edit-section" with data-section-id.
  assert.ok(
    /class\s*=\s*["'][^"']*edit-section[^"']*["']/.test(html),
    'renderedHtml() must contain elements with class "edit-section" — ' +
      "the per-section edit controls wired to editSection messages",
  );
  assert.ok(
    /data-section-id/.test(html),
    "renderedHtml() must contain data-section-id attributes — " +
      "the section id must be carried on edit-section and add-note controls so messages can be routed",
  );

  // Per-section add-note controls — class "add-note" with data-section-id.
  // (data-section-id is already checked above; this checks the class is present
  // on a separate control that sends addNote rather than editSection.)
  assert.ok(
    /class\s*=\s*["'][^"']*\badd-note\b[^"']*["']/.test(html),
    'renderedHtml() must contain elements with class "add-note" — ' +
      "the per-section add-note controls wired to addNote messages",
  );

  // The "Ask for structure" button — id "ask-structure".
  assert.ok(
    /id\s*=\s*["']ask-structure["']/.test(html),
    'renderedHtml() must contain an element with id="ask-structure" — ' +
      'the "Ask for structure" button wired to the askStructure message',
  );

  // The Freeze button — id "freeze" (existing round-1 control, must remain).
  assert.ok(
    /id\s*=\s*["']freeze["']/.test(html),
    'renderedHtml() must contain the existing <button id="freeze"> — ' +
      "the round-1 Freeze control must not have been removed by the round-2 changes",
  );
}
