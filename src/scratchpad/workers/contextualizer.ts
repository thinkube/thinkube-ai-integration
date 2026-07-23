// src/scratchpad/workers/contextualizer.ts — the context layer (2026-07-17).
//
// Field finding: blind workers decompose the journal from text alone, producing
// generic plausibility ("thinking NEAR the problem instead of ABOUT it"). The
// fix is NOT un-blinding (ambient reads are untraceable flavor — the .221
// lesson) but a SANCTIONED context channel: a round with read tools over
// DECLARED sources produces a bounded, citable digest dossier; every
// generative round then receives that digest verbatim, marked as context.
// Provenance survives: anything a worker knows beyond the journal is a line
// in a digest the human can open.

import type { WorkingModel } from "../model";
import type { DossierStore } from "./research";
import { summarizeEvent } from "./streamLog";

/** Topic/ref for a journal ask's context digest, stored at
 *  research/_ask-<n>.md and injected into the round that derives that ask. */
export function askDigestTopic(askNum: number): string {
  return `_ask-${askNum}`;
}
export function askDigestRef(askNum: number): string {
  return `research/${askDigestTopic(askNum)}.md`;
}

/** Build the per-ASK context prompt: a small digest scoped to ONE journal ask. */
export function buildAskContextPrompt(
  askNum: number,
  askText: string,
  sources: string[],
  assumptions: string[],
  existing: string | undefined,
): string {
  const src = sources.map((s) => `- ${s}`).join("\n");
  const asm = assumptions.map((a, i) => `${i + 1}. ${a}`).join("\n");
  return (
    `You are the CONTEXTUALIZER — an investigator, not a bulk reader. Produce a FOCUSED, SYNTHETIC ` +
    `context digest scoped to EXACTLY this one ask, so the round that derives it works against reality ` +
    `and doesn't invent open questions the codebase already answers.\n\n` +
    `THE ASK (ask #${askNum}):\n${askText}\n\n` +
    `DECLARED SOURCES (the ONLY places you may read — cite them):\n${src}\n\n` +
    (asm
      ? `Standing assumptions (already-settled truths — must not contradict; use them to know what NOT to investigate):\n${asm}\n\n`
      : "") +
    (existing
      ? `EXISTING DIGEST for this ask (refresh — keep what holds, correct what changed):\n${existing}\n\n`
      : "") +
    `HOW TO INVESTIGATE (do not Glob-and-read everything — that wastes turns and misses the point):\n` +
    `- GREP FIRST for the concepts this ask involves; Glob narrowly; Read only the spans that matter; follow references.\n` +
    `- Look for how ANALOGOUS concerns are ALREADY handled here (persistence, errors, logging, auth, config), ` +
    `and — just as important — what this codebase DELIBERATELY does NOT do (e.g. no auth layer anywhere → ` +
    `single-user; no per-tenant code → not multi-tenant). Absences answer as many questions as presences.\n` +
    `- Surface prior DECISIONS and conventions (TEPs, retros, defect lessons, established patterns) that pre-settle design choices.\n\n` +
    `THE DIGEST (markdown; distinct short sections):\n` +
    `- What EXISTS relevant to this ask, and where it lives (cite paths).\n` +
    `- CONVENTIONS & DELIBERATE OMISSIONS — how analogous concerns are handled, and what is intentionally absent.\n` +
    `- EXISTS-ALREADY vs GENUINELY-NEW split for this ask.\n` +
    `- CANDIDATE ASSUMPTIONS — platform-wide truths the code implies (e.g. "no auth anywhere → single-user platform") ` +
    `that a human could ratify once; list them plainly so they can suppress whole classes of non-questions.\n\n` +
    `Rules:\n` +
    `- SYNTHESIZE — distill each source to the few facts that change how this ask is built. Never reproduce whole files; ` +
    `a fact plus its source path beats a quotation.\n` +
    `- Every claim cites its source path. State uncertainty honestly ("not found in sources").\n` +
    `- Complete but no longer than it needs to be. NO recommendations, NO proposals — facts about what exists (and doesn't).\n` +
    `- Respond with ONLY the digest markdown (no preamble, no fences).`
  );
}

export interface ContextualizerDeps {
  loadQuery: () => import("./worker").QueryFn;
  model: string;
  dossier: DossierStore;
  /** Declared context sources (absolute paths) — the ONLY places the round
   *  may read. Typically [workspaceRoot, <sidecarRoot>/<namespace>]. */
  sources: string[];
  /** Optional sink for the live worker stream (tool calls + text), so the read
   *  round is followable in the "Thinkube Scratchpad" output. */
  log?: (line: string) => void;
}

/**
 * Run the read-tools round over the declared sources; returns the round's
 * final text (the digest), bounded, or undefined on failure (fail-soft — the
 * space simply stays context-blind until retried).
 */
async function readDigest(
  model: string,
  sources: string[],
  prompt: string,
  ceiling = 20000,
  log?: (line: string) => void,
  effort: "low" | "medium" | "high" | "xhigh" | "max" = "high",
): Promise<string | undefined> {
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
    return undefined;
  }
  try {
    let resultText = "";
    let assistantText = "";
    for await (const msg of sdkQuery({
      prompt,
      options: {
        model,
        permissionMode: "bypassPermissions",
        // Contextualize is INVESTIGATION — thinking on so it plans the search
        // (grep-first, targeted reads) instead of bulk-globbing. The bound is
        // maxTurns (the read loop) + effort (thinking depth). No USD cap: runs
        // ride the Claude Code subscription, so a notional-cost ceiling buys
        // nothing and aborts legitimate reads mid-digest (field defect: a $1
        // cap killed ask #1's digest outright).
        thinking: { type: "adaptive" },
        effort,
        maxTurns: 24,
        allowedTools: ["Read", "Grep", "Glob"],
        disallowedTools: [
          "Write",
          "Edit",
          "NotebookEdit",
          "Bash",
          "WebFetch",
          "WebSearch",
          "Task",
        ],
        additionalDirectories: sources,
      },
    })) {
      const rec = msg as Record<string, unknown>;
      const rendered = summarizeEvent(rec);
      if (rendered)
        for (const l of rendered.split("\n")) if (l.trim()) log?.(`  ${l}`);
      if (rec.type === "assistant") {
        const m = rec.message as { content?: unknown } | undefined;
        const content = Array.isArray(m?.content) ? m!.content : [];
        for (const b of content as Array<Record<string, unknown>>)
          if (b.type === "text" && typeof b.text === "string")
            assistantText += b.text;
      } else if (rec.type === "result" && typeof rec.result === "string") {
        resultText = rec.result;
      }
    }
    const digest = (resultText || assistantText).trim();
    if (!digest) return undefined;
    // The stored digest is an artifact the human opens — keep it COMPLETE. A
    // truncated artifact stamped with advice ("narrow the scope") is the
    // machine handing back its own failure. `ceiling` is only a runaway guard
    // against a pathological round; when it trips, clip SILENTLY at a paragraph
    // boundary — no marker, because directing the read is our job, not theirs.
    if (digest.length <= ceiling) return digest;
    const cut = digest.slice(0, ceiling);
    const lastBreak = cut.lastIndexOf("\n\n");
    return lastBreak > ceiling * 0.6 ? cut.slice(0, lastBreak) : cut;
  } catch {
    return undefined;
  }
}

/**
 * Read a small context digest scoped to one journal ask over the declared
 * sources, storing it at research/_ask-<n>.md. Returns { ref, text }, or
 * undefined when the round fails (fail-soft).
 */
export async function runContextualizeAsk(
  deps: ContextualizerDeps,
  askNum: number,
  askText: string,
  assumptions: string[],
): Promise<{ ref: string; text: string } | undefined> {
  const topic = askDigestTopic(askNum);
  const existing = await deps.dossier.read(topic);
  const prompt = buildAskContextPrompt(
    askNum,
    askText,
    deps.sources,
    assumptions,
    existing,
  );
  deps.log?.(`▸ contextualize ask #${askNum} (model: ${deps.model})`);
  // A focused, synthetic per-ask digest sits well under this; the ceiling is a
  // pure runaway guard, not a target — the stored file stays complete.
  const bounded = await readDigest(
    deps.model,
    deps.sources,
    prompt,
    24000,
    deps.log,
  );
  if (!bounded) return undefined;
  const { dossierRef } = await deps.dossier.write(topic, bounded);
  return { ref: dossierRef, text: bounded };
}

/**
 * Respond-only round for "question"-classified utterances (2026-07-17): a
 * blind answer grounded in the space + digest + assumptions. No actions, no
 * writes — just prose for the chat/command surface.
 */
export async function runQuestionAnswer(
  deps: { model: string },
  question: string,
  model: WorkingModel,
  contextDigest?: string,
): Promise<string | undefined> {
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
    return undefined;
  }
  const goalText =
    model.sections.find((s) => s.kind === "goal")?.text.trim() ?? "";
  const items = model.sections
    .filter((s) => s.kind !== "goal")
    .flatMap((s) =>
      s.items
        .filter((it) => it.state !== "dropped")
        .map(
          (it) =>
            `- [${s.kind}]${it.checked ? " ✓" : ""} ${it.text}`,
        ),
    )
    .join("\n");
  const prompt =
    `Answer the human's question about their thinking space, grounded ONLY in the material below. ` +
    `Be concise (a few sentences). If the material does not answer it, say so plainly.\n\n` +
    `Goal:\n${goalText}\n\nItems:\n${items}\n` +
    (model.assumptions?.length
      ? `\nStanding assumptions:\n${model.assumptions.map((a, i) => `${i + 1}. ${a.text}`).join("\n")}\n`
      : "") +
    (contextDigest ? `\nContext digest:\n${contextDigest.slice(0, 4000)}\n` : "") +
    (model.curatedIntent ? `\nCurated intent:\n${model.curatedIntent}\n` : "") +
    `\nQuestion: ${question}`;
  try {
    let resultText = "";
    let assistantText = "";
    for await (const msg of sdkQuery({
      prompt,
      options: {
        model: deps.model,
        permissionMode: "bypassPermissions",
        thinking: { type: "disabled" },
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
      if (rec.type === "assistant") {
        const m = rec.message as { content?: unknown } | undefined;
        const content = Array.isArray(m?.content) ? m!.content : [];
        for (const b of content as Array<Record<string, unknown>>) {
          if (b.type === "text" && typeof b.text === "string") {
            assistantText += b.text;
          }
        }
      } else if (rec.type === "result" && typeof rec.result === "string") {
        resultText = rec.result;
      }
    }
    const answer = (resultText || assistantText).trim();
    return answer || undefined;
  } catch {
    return undefined;
  }
}

