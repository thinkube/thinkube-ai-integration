import { createPhaseWorker, GATES } from "./worker";
import type { WorkerFactoryDeps, WorkerRun } from "./worker";

/**
 * Adversarial worker — constructed with blindToConversation:true and
 * pre-gated with GATES.adversarial.
 * allowed: [addObjection]
 * disallowed: [editGoal, editSection, proposeSection, freeze, writeArtifact]
 *
 * The authoring conversation is withheld from its prompt (blinding).
 * run yields only { type: 'addObjection', text } actions.
 */
export function adversarial(deps: WorkerFactoryDeps): WorkerRun {
  return createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.adversarial.allowedTools,
    disallowedTools: GATES.adversarial.disallowedTools,
    blindToConversation: true,
  });
}
