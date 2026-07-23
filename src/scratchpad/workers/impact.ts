/**
 * The IMPACT pass (2026-07-18).
 *
 * Adding an entry to an already-derived space is not always additive. A new ask
 * can CONTRADICT what is already committed ("actually the log panel should be a
 * separate window" vs a decided constraint saying it is docked), SUPERSEDE it
 * ("drop the paginated API, stream instead"), or make it STALE. Incremental
 * derivation alone would simply append the new item and leave both live — a
 * self-contradicting space that would happily freeze into a TEP.
 *
 * So after deriving a new entry, this judgment round reads the new entry
 * against the existing space and reports what it collides with. It APPLIES
 * NOTHING: findings are annotated onto the affected items and STAGED for the
 * human, who keeps, drops, or supersedes them. Detection and explanation are
 * the machine's job; the verdict stays human — the same doctrine the
 * assumption-challenger already follows.
 *
 * A blind round (no read tools) over the model + digest, so thinking cannot run
 * away on an unbounded read loop.
 */

import type { WorkingModel } from "../model";
import { thinkyDiag } from "../chat/diag";
import { summarizeEvent } from "./streamLog";

/** One collision between a new journal entry and an existing item. */
export interface ImpactFinding {
  itemId: string;
  kind: "contradicted" | "superseded" | "stale";
  why: string;
}

/**
 * An accusation against a journal ENTRY rather than an item — the upward
 * channel (2026-07-23). Derivation used to flow one way: an ask produced
 * items, and when the derivation revealed that the ask itself was the problem,
 * that finding had nowhere to land. Now a round can say so and propose better
 * words. It stages nothing: the human accepts, edits, or ignores it.
 */
export interface EntryFinding {
  entry: number;
  kind: "underspecified" | "self-contradictory" | "contradicted-by-context";
  why: string;
  /** A proposed rewording, offered as a starting point, never applied. */
  suggestedText?: string;
}

export interface ImpactReport {
  findings: ImpactFinding[];
  /** Ways the NEW ask itself conflicts with a standing assumption or an
   *  existing constraint — i.e. it may not be satisfiable as written. */
  askConflicts: string[];
  /** Entries the round believes are themselves at fault. */
  entryFindings: EntryFinding[];
}

/** Every active item the new entry could collide with, id + kind + text. */
function reviewableItems(
  model: WorkingModel,
): { id: string; kind: string; text: string }[] {
  return model.sections
    .filter((s) => s.kind !== "goal")
    .flatMap((s) =>
      s.items
        .filter((it) => it.state === "active")
        .map((it) => ({ id: it.id, kind: s.kind, text: it.text })),
    );
}

/** Build the impact prompt. Pure; exported for tests. */
export function buildImpactPrompt(
  model: WorkingModel,
  newEntries: { n: number; text: string }[],
  contextDigest?: string,
): string {
  const items = reviewableItems(model)
    .map((i) => `  - ${i.id} [${i.kind}]: ${i.text}`)
    .join("\n");
  const entries = newEntries
    .map((e) => `${e.n}. ${e.text}`)
    .join("\n");
  const assumptions = (model.assumptions ?? [])
    .map((a, i) => `${i + 1}. ${a.text}`)
    .join("\n");
  const digest = (contextDigest ?? "").trim();
  return (
    `You are the IMPACT pass. A journal entry was just ADDED to a space that was already derived. ` +
    `Decide what it COLLIDES with — do not re-derive anything.\n\n` +
    `THE NEW ENTR${newEntries.length === 1 ? "Y" : "IES"}:\n${entries}\n\n` +
    (assumptions ? `STANDING ASSUMPTIONS:\n${assumptions}\n\n` : "") +
    (digest ? `CONTEXT DIGEST (what exists):\n${digest.slice(0, 6000)}\n\n` : "") +
    `THE EXISTING SPACE (active items):\n${items}\n\n` +
    `Report ONLY genuine collisions:\n` +
    `- "contradicted" — the new entry asserts something incompatible with this item ` +
    `(e.g. it says a panel is a separate window while this item commits to it being docked).\n` +
    `- "superseded" — the new entry replaces this item's commitment outright.\n` +
    `- "stale" — this item's rationale depended on something the new entry changes.\n\n` +
    `Also report askConflicts: ways the NEW entry conflicts with a standing assumption or an ` +
    `existing constraint, i.e. it may not be satisfiable as written.\n\n` +
    `Finally, report entryFindings — cases where the JOURNAL ENTRY ITSELF is the problem, not the items ` +
    `derived from it:\n` +
    `- "underspecified" — it cannot be built as written without inventing intent.\n` +
    `- "self-contradictory" — it asks for two things that cannot both hold.\n` +
    `- "contradicted-by-context" — the code or the standing assumptions say it is not the case.\n` +
    `Give a suggestedText: the same ask written so the problem disappears, in the author's own register — ` +
    `a proposal for them to accept or reject, never a rewrite you apply. Say nothing when the entry is fine; ` +
    `a workable ask is the normal case.\n\n` +
    `Rules:\n` +
    `- An item the new entry merely ADDS TO is NOT a collision. Only report real incompatibility. ` +
    `Most items are untouched — reporting nothing is the normal, correct answer.\n` +
    `- NEVER invent item ids — use exactly the ids above.\n` +
    `- Respond with ONE JSON object: ` +
    `{"findings":[{"itemId":"...","kind":"contradicted","why":"one sentence"}],"askConflicts":["..."],` +
    `"entryFindings":[{"entry":2,"kind":"underspecified","why":"one sentence","suggestedText":"..."}]}. ` +
    `No prose outside it.`
  );
}

/** Parse + validate the round's JSON against the live item ids. */
export function parseImpactReport(
  raw: string,
  validIds: Set<string>,
  validEntries?: Set<number>,
): ImpactReport {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return { findings: [], askConflicts: [], entryFindings: [] };
  let parsed: {
    findings?: unknown;
    askConflicts?: unknown;
    entryFindings?: unknown;
  };
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as typeof parsed;
  } catch {
    return { findings: [], askConflicts: [], entryFindings: [] };
  }
  const kinds = new Set(["contradicted", "superseded", "stale"]);
  const findings: ImpactFinding[] = [];
  const seen = new Set<string>();
  for (const f of Array.isArray(parsed.findings) ? parsed.findings : []) {
    if (typeof f !== "object" || f === null) continue;
    const rec = f as Record<string, unknown>;
    const itemId = typeof rec.itemId === "string" ? rec.itemId : "";
    const kind = typeof rec.kind === "string" ? rec.kind : "";
    if (!validIds.has(itemId) || seen.has(itemId) || !kinds.has(kind)) continue;
    findings.push({
      itemId,
      kind: kind as ImpactFinding["kind"],
      why: typeof rec.why === "string" ? rec.why.trim() : "",
    });
    seen.add(itemId);
  }
  const askConflicts = (
    Array.isArray(parsed.askConflicts) ? parsed.askConflicts : []
  )
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .map((c) => c.trim());
  const entryKinds = new Set([
    "underspecified",
    "self-contradictory",
    "contradicted-by-context",
  ]);
  const entryFindings: EntryFinding[] = [];
  const seenEntries = new Set<number>();
  for (const f of Array.isArray(parsed.entryFindings) ? parsed.entryFindings : []) {
    if (typeof f !== "object" || f === null) continue;
    const rec = f as Record<string, unknown>;
    const entry = typeof rec.entry === "number" ? rec.entry : NaN;
    const kind = typeof rec.kind === "string" ? rec.kind : "";
    if (!Number.isInteger(entry) || entry < 1) continue;
    if (validEntries !== undefined && !validEntries.has(entry)) continue;
    if (seenEntries.has(entry) || !entryKinds.has(kind)) continue;
    const suggested =
      typeof rec.suggestedText === "string" ? rec.suggestedText.trim() : "";
    entryFindings.push({
      entry,
      kind: kind as EntryFinding["kind"],
      why: typeof rec.why === "string" ? rec.why.trim() : "",
      ...(suggested ? { suggestedText: suggested } : {}),
    });
    seenEntries.add(entry);
  }
  return { findings, askConflicts, entryFindings };
}

/**
 * Run the impact round. Blind (no read tools) — it judges the model + digest.
 * Fail-soft: an empty report on any failure, so a new entry still lands.
 */
export async function runImpactPass(
  deps: {
    model: string;
    contextDigest?: string;
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
    log?: (line: string) => void;
  },
  workingModel: WorkingModel,
  newEntries: { n: number; text: string }[],
): Promise<ImpactReport> {
  const items = reviewableItems(workingModel);
  if (items.length === 0 || newEntries.length === 0)
    return { findings: [], askConflicts: [], entryFindings: [] };

  let sdkQuery: (args: {
    prompt: string;
    options: Record<string, unknown>;
  }) => AsyncIterable<unknown>;
  try {
    const mod = (await import("@anthropic-ai/claude-agent-sdk")) as {
      query: typeof sdkQuery;
    };
    sdkQuery = mod.query;
  } catch {
    return { findings: [], askConflicts: [], entryFindings: [] };
  }

  const prompt = buildImpactPrompt(workingModel, newEntries, deps.contextDigest);
  let text = "";
  deps.log?.(
    `▸ impact: entr${newEntries.length === 1 ? "y" : "ies"} ${newEntries
      .map((e) => e.n)
      .join(", ")} vs ${items.length} existing item(s) (model: ${deps.model})`,
  );
  try {
    for await (const msg of sdkQuery({
      prompt,
      options: {
        model: deps.model,
        permissionMode: "bypassPermissions",
        thinking: { type: "adaptive" },
        effort: deps.effort ?? "high",
        disallowedTools: [
          "Read",
          "Grep",
          "Glob",
          "Bash",
          "WebFetch",
          "WebSearch",
          "Write",
          "Edit",
          "NotebookEdit",
          "Task",
        ],
      },
    })) {
      const rec = msg as Record<string, unknown>;
      const rendered = summarizeEvent(rec);
      if (rendered)
        for (const l of rendered.split("\n")) if (l.trim()) deps.log?.(`  ${l}`);
      if (rec.type === "assistant") {
        const m = rec.message as { content?: unknown } | undefined;
        const content = Array.isArray(m?.content) ? m!.content : [];
        for (const b of content as Array<Record<string, unknown>>)
          if (b.type === "text" && typeof b.text === "string") text += b.text;
      } else if (rec.type === "result" && typeof rec.result === "string") {
        text = rec.result;
      }
    }
  } catch (err) {
    thinkyDiag(
      `impact SDK error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { findings: [], askConflicts: [], entryFindings: [] };
  }
  const report = parseImpactReport(
    text,
    new Set(items.map((i) => i.id)),
    new Set(newEntries.map((e) => e.n)),
  );
  thinkyDiag(
    `impact: ${report.findings.length} collision(s), ${report.askConflicts.length} ask-conflict(s), ` +
      `${report.entryFindings.length} entry finding(s)`,
  );
  return report;
}
