import { createPhaseWorker, GATES } from "./worker";
import type { WorkerFactoryDeps, WorkerRun } from "./worker";

export function reframe(deps: WorkerFactoryDeps): WorkerRun {
  return createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.reframe.allowedTools,
    disallowedTools: GATES.reframe.disallowedTools,
  });
}
