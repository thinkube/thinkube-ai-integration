import { createPhaseWorker, GATES } from "./worker";
import type { WorkerFactoryDeps, WorkerRun } from "./worker";
import type { WorkingModel } from "../model";
import { renderActionGuide } from "./actionGuide";

/**
 * Reframe worker — pre-gated with GATES.reframe.
 * allowed: [curateIntent]   (2026-07-16 redesign: reframe MAINTAINS THE
 * CURATED INTENT — it never again edits the human's goal/rough words.)
 * disallowed: everything else, editGoal explicitly included.
 *
 * Prompt content rule (SP-21/3 contract, preserved): the prompt contains the
 * verbatim text of CHECKED items ONLY and NO unchecked item's text — plus the
 * human's rough requests (their raw asks, which the curated intent must
 * cover). With a cut scope, only checked items INSIDE the cut are shown, so
 * the curated intent describes the upcoming TEP, not the whole space.
 */
export function reframe(
  deps: WorkerFactoryDeps,
  scope?: { itemIds: ReadonlySet<string> },
): WorkerRun {
  const base = createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.reframe.allowedTools,
    disallowedTools: GATES.reframe.disallowedTools,
  });

  return {
    ...base,
    buildPrompt(workingModel: WorkingModel, _conversation: string[]): string {
      // Collect only checked items — unchecked text must never appear.
      // With a cut scope, only checked items inside the cut are shown.
      const checkedLines: string[] = [];
      for (const section of workingModel.sections) {
        for (const item of section.items) {
          if (!item.checked) continue;
          if (scope !== undefined && !scope.itemIds.has(item.id)) continue;
          checkedLines.push(`  [${section.kind}] ${item.text}`);
        }
      }

      const checkedBlock =
        checkedLines.length > 0
          ? checkedLines.join("\n")
          : "(no checked items yet)";

      const requests = workingModel.roughRequests ?? [];
      const goalText =
        workingModel.sections.find((s) => s.kind === "goal")?.text ?? "";
      const requestLines = [
        ...(goalText.trim() ? [`  - ${goalText.trim()}`] : []),
        ...requests.map((r) => `  - ${r.text}`),
      ];
      const requestsBlock =
        requestLines.length > 0 ? requestLines.join("\n") : "  (none)";

      return (
        `You are the reframe worker. Synthesize the CURATED INTENT${scope ? " for the current CUT (an upcoming TEP)" : ""}: ` +
        `a precise, concise statement of what ${scope ? "this selection" : "this thinking space"} intends, ` +
        `grounded in the settled (checked) items below and covering the human's rough requests. ` +
        `You NEVER edit the human's words — the curated intent is a separate, derived statement.\n\n` +
        `Rough requests (the human's raw asks — the curated intent must cover ${scope ? "the ones this cut addresses" : "ALL of them"}):\n${requestsBlock}\n\n` +
        `Checked items only${scope ? " (inside the cut)" : ""}:\n${checkedBlock}\n\n` +
        `Produce a curateIntent action. Do not include any unchecked item's content.\n\n` +
        renderActionGuide(workingModel, GATES.reframe.allowedTools, "integrator")
      );
    },
  };
}
