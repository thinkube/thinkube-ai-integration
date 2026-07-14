/**
 * SP-21/2 AC-2 — A person's actions accumulate — visibly, via the panel's own controls.
 *
 * WHY (INVARIANT): Every authoring act the person performs in the open panel —
 * typing a Goal draft, editing a section's text, adding a note — travels the
 * panel's REAL message wiring (postFromWebview → the one reducer) and after
 * each act the panel visibly shows all prior work intact. The seeded goal text,
 * the edit, and the note are all present together in renderedHtml() after every
 * step; nothing the person did between acts is lost. This must hold forever:
 * any refactor that resets the model between webview messages or opens a fresh
 * model per-message breaks this test.
 *
 * The model change produced by each postFromWebview message is also asserted to
 * equal the model the pure reducer would produce for the equivalent dispatch —
 * proving that postFromWebview is wired to the same reducer path.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";
import type { ScratchpadSession } from "../scratchpad/session";
import { reduce } from "../scratchpad/model";
import type { WorkingModel } from "../scratchpad/model";

// ── Round-2 protocol additions ────────────────────────────────────────────────
// postFromWebview and ScratchpadInboundMessage are not yet in session.ts;
// they resolve once the implementer adds them per the SPEC CONTRACT.
// We define them locally here (verbatim from the contract) so the test compiles
// before the implementation ships and fails the RIGHT way (no such method) rather
// than a type error.
type ScratchpadInboundMessage =
  | { type: "seedGoal"; text: string }
  | { type: "editGoal"; text: string }
  | { type: "editSection"; id: string; text: string }
  | { type: "addNote"; sectionId: string; text: string }
  | { type: "askStructure" };

type WithPostFromWebview = ScratchpadSession & {
  /** The panel's real inbound path (SPEC CONTRACT, round 2). */
  postFromWebview(message: ScratchpadInboundMessage): Promise<void>;
};

// ── Marker strings ─────────────────────────────────────────────────────────────
// All-caps alphanumeric only — HTML escaping (esc/showValue) cannot mask them.
// GOAL_MARKER seeds the goal and then becomes the "before" value of the edit
// delta — visible in the delta log as &quot;SEEDGOALMARKERTEXT&quot;, which
// .includes("SEEDGOALMARKERTEXT") still matches.
const GOAL_MARKER = "SEEDGOALMARKERTEXT";
const EDIT_MARKER = "EDITSECTIONMARKERTEXT";
const NOTE_MARKER = "ADDNOTEMARKERTEXT";

/** Deep-freeze a working model snapshot via serialisation round-trip. */
function snap(model: WorkingModel): WorkingModel {
  return JSON.parse(JSON.stringify(model)) as WorkingModel;
}

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-2-ac2-v2");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  // Obtain the session and widen the type to include the round-2 seam.
  const raw = await api.scratchpad.openScratchpad({ sidecarRoot: tmpDir });
  assert.ok(raw, "openScratchpad must return a live session");
  const session = raw as unknown as WithPostFromWebview;

  assert.equal(
    typeof session.postFromWebview,
    "function",
    "session must expose postFromWebview — the round-2 panel inbound path is present on the session object",
  );

  // ── Step 1: seedGoal — person types a rough Goal draft into the Goal area ──
  //
  // WHY: the panel's Goal area must send the typed text to the session via the
  // real webview message channel; the model accumulates this as the first act.
  const beforeSeed = snap(session.model);
  await session.postFromWebview({ type: "seedGoal", text: GOAL_MARKER });

  // Model change equals what programmatic dispatch would produce.
  const { model: expectedAfterSeed } = reduce(beforeSeed, {
    type: "seedGoal",
    text: GOAL_MARKER,
  });
  assert.deepStrictEqual(
    session.model,
    expectedAfterSeed,
    "after seedGoal via postFromWebview, session.model must equal what the equivalent programmatic dispatch produces through the same reducer",
  );

  const goalSection = session.model.sections.find((s) => s.kind === "goal");
  assert.ok(goalSection, "a goal section must exist after seedGoal");
  const goalId = goalSection.id;

  // Panel renders the seeded goal text after the first act.
  const html1 = session.renderedHtml();
  assert.ok(
    html1.includes(GOAL_MARKER),
    `renderedHtml() must contain '${GOAL_MARKER}' immediately after seedGoal — ` +
      "the Goal draft is visible in the panel",
  );

  // ── Step 2: editSection — person edits the section's text ─────────────────
  //
  // WHY: the panel's per-section edit control sends the updated text; prior work
  // (the seeded goal) must still be visible (now in the delta log as before-value)
  // together with the new edited text.
  const beforeEdit = snap(session.model);
  await session.postFromWebview({
    type: "editSection",
    id: goalId,
    text: EDIT_MARKER,
  });

  const { model: expectedAfterEdit } = reduce(beforeEdit, {
    type: "editSection",
    id: goalId,
    text: EDIT_MARKER,
  });
  assert.deepStrictEqual(
    session.model,
    expectedAfterEdit,
    "after editSection via postFromWebview, session.model must equal what the equivalent programmatic dispatch produces",
  );

  // Accumulation: GOAL_MARKER persists in the delta log (as before-value of the
  // editSection delta); EDIT_MARKER is the live section text.
  const html2 = session.renderedHtml();
  assert.ok(
    html2.includes(GOAL_MARKER),
    `renderedHtml() must still contain '${GOAL_MARKER}' after editSection — ` +
      "the seed goal text must appear in the delta log (not silently discarded)",
  );
  assert.ok(
    html2.includes(EDIT_MARKER),
    `renderedHtml() must contain '${EDIT_MARKER}' after editSection — ` +
      "the edited section text is visible in the live section",
  );

  // ── Step 3: addNote — person adds a note via the add-note control ─────────
  //
  // WHY: the panel's per-section add-note control appends the note text; all
  // three markers — the seed goal, the edit, and the note — must be visible
  // together after this third act. Nothing is lost.
  const beforeNote = snap(session.model);
  await session.postFromWebview({
    type: "addNote",
    sectionId: goalId,
    text: NOTE_MARKER,
  });

  const { model: expectedAfterNote } = reduce(beforeNote, {
    type: "addNote",
    sectionId: goalId,
    text: NOTE_MARKER,
  });
  assert.deepStrictEqual(
    session.model,
    expectedAfterNote,
    "after addNote via postFromWebview, session.model must equal what the equivalent programmatic dispatch produces",
  );

  // Accumulation: all three markers visible together — nothing lost.
  const html3 = session.renderedHtml();
  assert.ok(
    html3.includes(GOAL_MARKER),
    `renderedHtml() must still contain '${GOAL_MARKER}' after addNote — ` +
      "the seed goal text must remain in the delta log (accumulation, not replacement)",
  );
  assert.ok(
    html3.includes(EDIT_MARKER),
    `renderedHtml() must still contain '${EDIT_MARKER}' after addNote — ` +
      "the edited section text must remain visible (not overwritten by addNote)",
  );
  assert.ok(
    html3.includes(NOTE_MARKER),
    `renderedHtml() must contain '${NOTE_MARKER}' after addNote — ` +
      "the note text is visible in the panel alongside earlier work",
  );

  // Confirm exactly three deltas — one per act, in order, no extras.
  assert.equal(
    session.deltas.length,
    3,
    "three acts must produce exactly three deltas — one per postFromWebview call",
  );
  assert.equal(session.deltas[0].action.type, "seedGoal");
  assert.equal(session.deltas[1].action.type, "editSection");
  assert.equal(session.deltas[2].action.type, "addNote");
}
