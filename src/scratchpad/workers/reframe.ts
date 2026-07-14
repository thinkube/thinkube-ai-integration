import { createPhaseWorker, GATES } from "./worker";
import type { WorkerFactoryDeps, WorkerRun } from "./worker";
import type { WorkingModel } from "../model";

export function reframe(deps: WorkerFactoryDeps): WorkerRun {
  const base = createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.reframe.allowedTools,
    disallowedTools: GATES.reframe.disallowedTools,
  });

  return {
    ...base,
    // Override buildPrompt to build exclusively from settled non-goal sections.
    // The original goal seed must NOT appear: if it leaked in, the model would
    // anchor to the rough draft rather than synthesising from settled sections
    // (AC-10 invariant — must hold forever).
    buildPrompt(workingModel: WorkingModel, _conversation: string[]): string {
      const settledSections = workingModel.sections.filter(
        (s) => s.kind !== "goal" && s.state === "settled",
      );
      const sectionsText = settledSections
        .map((s) => `[${s.kind}]\n${s.text}`)
        .join("\n\n");
      return (
        `Synthesise a precise Goal from the following settled sections.\n\n` +
        `Settled Sections:\n${sectionsText}`
      );
    },
  };
}
