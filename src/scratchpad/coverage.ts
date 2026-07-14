import type { WorkingModel, SectionKind } from "./model";

/**
 * Returns the kinds of every section whose coverage is not 'verified'.
 *
 * A section is "red" (uncovered) until its coverage field equals 'verified'.
 * An empty result means all sections are green (fully covered).
 */
export function uncoveredSections(model: WorkingModel): SectionKind[] {
  return model.sections
    .filter((s) => s.coverage !== "verified")
    .map((s) => s.kind);
}
