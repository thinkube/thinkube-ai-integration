// TANDEM_PHASES=2
/**
 * SP-21/2 AC-4 — Close and reopen resumes exactly — for the person.
 *
 * WHY (INVARIANT): After the Scratchpad is closed (extension host restarted)
 * and reopened with the same sidecarRoot, the person sees in the rendered panel
 * exactly what they left — every section with its text and state marker, notes,
 * worker proposals, adversarial objections, readiness history, and the current
 * phase — and can immediately continue authoring. The RENDERED HTML is the
 * assertion, not the deserialized object alone; seeing is the criterion.
 * The deserialized model is also asserted to deep-equal the phase-0 snapshot
 * (belt-and-suspenders: both the render AND the underlying object must survive).
 * This must hold forever; any refactor that skips deserializing the session file
 * on cold-start, or that reconstructs the model without all fields, breaks it.
 *
 * Two fresh extension hosts, same fixed sidecarRoot:
 *   Phase 0 — author one of every entity kind via the panel's real inbound
 *              paths (postFromWebview for goal and note; dispatch for the rest
 *              of the protocol-absent actions), flush(), save model as
 *              expected.json.
 *   Phase 1 — openScratchpad with the same root, assert renderedHtml() shows
 *              every restored element, and assert model deep-equals expected.json.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";
import type { ScratchpadSession } from "../scratchpad/session";

// ── Round-2 protocol additions ────────────────────────────────────────────────
type ScratchpadInboundMessage =
  | { type: "seedGoal"; text: string }
  | { type: "editGoal"; text: string }
  | { type: "editSection"; id: string; text: string }
  | { type: "addNote"; sectionId: string; text: string }
  | { type: "askStructure" };

type WithPostFromWebview = ScratchpadSession & {
  postFromWebview(message: ScratchpadInboundMessage): Promise<void>;
};

// ── Fixed paths — deterministic, no Date.now() / Math.random() ───────────────
const SIDECAR_ROOT = path.join(os.tmpdir(), "tandem-probe-sp21-2-ac4-v2");
const CURRENT_JSON = path.join(SIDECAR_ROOT, "scratchpad", "current.json");
const EXPECTED_JSON = path.join(SIDECAR_ROOT, "scratchpad", "expected.json");

// ── Marker strings — all-caps alphanumeric, HTML-escape safe ─────────────────
const GOAL_MARKER = "GOALMARKERTEXT";
const PROPOSAL_MARKER = "PROPOSALMARKERTEXT";
const NOTE_MARKER = "NOTEMARKERTEXT";
const OBJECTION_MARKER = "OBJECTIONMARKERTEXT";

/** Helpers for the phase-1 freeze-button check (mirrors SP-21/2 AC-6). */
function freezeButtonTag(html: string): string | undefined {
  const m = html.match(/<button\b[^>]*\bid\s*=\s*["']freeze["'][^>]*>/i);
  return m ? m[0] : undefined;
}

function freezeIsDisabled(html: string): boolean {
  const tag = freezeButtonTag(html);
  if (!tag) {
    throw new Error(
      'renderedHtml() contains no <button id="freeze"> — ' +
        "the Freeze control must always be rendered in the scratchpad panel",
    );
  }
  return /\bdisabled\b/.test(tag);
}

export async function run(phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  if (phase === 0) {
    // ── Phase 0: author every entity kind, persist, save expected ─────────────
    fs.rmSync(SIDECAR_ROOT, { recursive: true, force: true });
    fs.mkdirSync(SIDECAR_ROOT, { recursive: true });

    const raw = await api.scratchpad.openScratchpad({
      sidecarRoot: SIDECAR_ROOT,
    });
    assert.ok(raw, "openScratchpad must return a live session in phase 0");
    const session = raw as unknown as WithPostFromWebview;

    assert.equal(
      typeof session.postFromWebview,
      "function",
      "session must expose postFromWebview in phase 0",
    );

    // ── Goal via the panel's real inbound path (postFromWebview) ──────────────
    await session.postFromWebview({ type: "seedGoal", text: GOAL_MARKER });

    const goalSection = session.model.sections.find((s) => s.kind === "goal");
    assert.ok(goalSection, "goal section must exist after seedGoal");
    const goalId = goalSection.id;

    // ── Proposed section + state change (proposeSection/setSectionState are
    //    not in the webview protocol — authored through dispatch directly) ──────
    session.dispatch({
      type: "proposeSection",
      kind: "constraints",
      text: PROPOSAL_MARKER,
      workerId: "probe-worker",
    });

    const proposedSection = session.model.sections.find(
      (s) => s.kind === "constraints",
    );
    assert.ok(
      proposedSection,
      "constraints section must exist after proposeSection",
    );
    // Settle the section so the state marker (●) is visible in phase 1.
    session.dispatch({
      type: "setSectionState",
      id: proposedSection.id,
      state: "settled",
    });

    // ── Note via the panel's real inbound path ────────────────────────────────
    await session.postFromWebview({
      type: "addNote",
      sectionId: goalId,
      text: NOTE_MARKER,
    });

    // ── Objection (not in webview protocol) ───────────────────────────────────
    session.dispatch({ type: "addObjection", text: OBJECTION_MARKER });

    // ── Readiness record — covered AND cleanCut so Freeze is enabled ──────────
    session.dispatch({
      type: "recordReadiness",
      record: { covered: true, cleanCut: true, gapSection: null },
    });

    // ── Phase change ──────────────────────────────────────────────────────────
    session.dispatch({ type: "setPhase", phase: "reframing" });

    // Force debounced persistence to disk before the host exits.
    await session.flush();

    assert.ok(
      fs.existsSync(CURRENT_JSON),
      `session file must exist at ${CURRENT_JSON} after flush()`,
    );

    // Save the live model as the reference for phase 1 assertions.
    fs.mkdirSync(path.dirname(EXPECTED_JSON), { recursive: true });
    fs.writeFileSync(EXPECTED_JSON, JSON.stringify(session.model), "utf8");

    assert.ok(
      fs.existsSync(EXPECTED_JSON),
      "expected.json must be written for phase 1 to compare against",
    );
  } else {
    // ── Phase 1: Cold-start resume — rendered panel is the assertion ───────────
    assert.ok(
      fs.existsSync(EXPECTED_JSON),
      `expected.json must exist at ${EXPECTED_JSON} — was phase 0 skipped or did flush() fail?`,
    );
    assert.ok(
      fs.existsSync(CURRENT_JSON),
      `current.json must exist at ${CURRENT_JSON} — phase 1 depends on phase 0 writing it`,
    );

    const expected = JSON.parse(
      fs.readFileSync(EXPECTED_JSON, "utf8"),
    ) as object;

    // Cold-start: openScratchpad with the same sidecarRoot deserializes current.json.
    const session = await api.scratchpad.openScratchpad({
      sidecarRoot: SIDECAR_ROOT,
    });
    assert.ok(session, "openScratchpad must return a live session in phase 1");

    // ── The RENDERED PANEL is the assertion: the person sees their work ────────
    const html = session.renderedHtml();

    // Goal section text (GOAL_MARKER is in section.text — not only the delta log,
    // since we did not edit the goal away in phase 0).
    assert.ok(
      html.includes(GOAL_MARKER),
      `renderedHtml() must contain '${GOAL_MARKER}' — the seeded goal text must be visible in the resumed panel`,
    );

    // Proposed-then-settled section text.
    assert.ok(
      html.includes(PROPOSAL_MARKER),
      `renderedHtml() must contain '${PROPOSAL_MARKER}' — the worker-proposed section text must survive resume`,
    );

    // State marker for the settled constraints section (● = settled).
    assert.ok(
      html.includes("●"),
      "renderedHtml() must contain '●' — the settled-state marker for the constraints section must be visible after resume",
    );

    // Note text.
    assert.ok(
      html.includes(NOTE_MARKER),
      `renderedHtml() must contain '${NOTE_MARKER}' — the note text must be visible in the resumed panel`,
    );

    // Objection text.
    assert.ok(
      html.includes(OBJECTION_MARKER),
      `renderedHtml() must contain '${OBJECTION_MARKER}' — the adversarial objection must be visible after resume`,
    );

    // Phase shown in the h1 span.
    assert.ok(
      html.includes("reframing"),
      "renderedHtml() must contain 'reframing' — the current phase must be visible in the panel heading after resume",
    );

    // Readiness state: freeze button NOT disabled (covered=true AND cleanCut=true).
    assert.ok(
      !freezeIsDisabled(html),
      "the Freeze button must NOT carry the disabled attribute — " +
        "the readiness record (covered=true, cleanCut=true) must survive resume and re-enable the control",
    );

    // ── Belt-and-suspenders: the deserialized model must also deep-equal ───────
    assert.deepStrictEqual(
      session.model,
      expected,
      "model after cold-start resume must deep-equal the model that was flushed in phase 0 — " +
        "all fields (sections, states, notes, proposals, objections, readinessHistory, phase) must be reconstituted",
    );
  }
}
