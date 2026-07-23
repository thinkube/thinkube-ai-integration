/**
 * Worker-stream rendering for the "Thinkube Scratchpad" output — the same
 * readable one-liners the delivery orchestrator produces (a tool call PLUS the
 * part that matters: the command, file, pattern), so a scratchpad round is as
 * followable as an /orchestrate run rather than a column of bare markers.
 *
 * These are pure functions copied from `services/orchestratorCore` (which is a
 * large module pulling in child_process/crypto/templates); duplicating ~60
 * lines of formatting keeps the scratchpad worker graph light and vscode-free.
 */

const clip = (x: string, n: number): string =>
  x.length > n ? x.slice(0, n - 1) + "…" : x;

/** A readable one-liner for a tool_use — name PLUS the salient argument. */
export function toolUseSummary(name: string, input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (name) {
    case "Bash":
      return `▸ $ ${clip(str(inp.command).replace(/\s+/g, " "), 160)}`;
    case "Read":
      return `▸ Read ${str(inp.file_path)}`;
    case "Write":
      return `▸ Write ${str(inp.file_path)}`;
    case "Edit":
    case "MultiEdit":
      return `▸ Edit ${str(inp.file_path)}`;
    case "Glob":
      return `▸ Glob ${str(inp.pattern)}`;
    case "Grep":
      return `▸ Grep ${str(inp.pattern)}${inp.path ? ` in ${str(inp.path)}` : ""}`;
    default: {
      let j = "";
      try {
        j = JSON.stringify(inp);
      } catch {
        /* unserializable */
      }
      return `▸ ${name}${j && j !== "{}" ? ` ${clip(j, 120)}` : ""}`;
    }
  }
}

/** A one-line snippet of a tool_result (the first non-empty line). */
export function toolResultSummary(
  block: Record<string, unknown>,
): string | null {
  let text = "";
  if (typeof block.content === "string") text = block.content;
  else if (Array.isArray(block.content))
    text = (block.content as Array<Record<string, unknown>>)
      .filter((x) => x.type === "text" && typeof x.text === "string")
      .map((x) => x.text as string)
      .join(" ");
  const first = text
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!first) return null;
  return `   ${block.is_error === true ? "✗" : "⤷"} ${clip(first, 160)}`;
}

/**
 * Summarize one SDK stream event into newline-joined lines (or null to skip):
 * assistant text + tool_use with its input, tool_result snippets, and the
 * final result marker.
 */
export function summarizeEvent(evt: Record<string, unknown>): string | null {
  if (evt.type === "system" && evt.subtype === "init")
    return "▸ session started";
  if (evt.type === "assistant") {
    const msg = evt.message as { content?: unknown } | undefined;
    const content = Array.isArray(msg?.content) ? msg!.content : [];
    const parts: string[] = [];
    for (const b of content as Array<Record<string, unknown>>) {
      if (b.type === "text" && typeof b.text === "string" && b.text.trim())
        parts.push(b.text.trim());
      if (b.type === "tool_use" && typeof b.name === "string")
        parts.push(toolUseSummary(b.name, b.input));
    }
    return parts.length ? parts.join("\n") : null;
  }
  if (evt.type === "user") {
    const msg = evt.message as { content?: unknown } | undefined;
    const content = Array.isArray(msg?.content) ? msg!.content : [];
    const parts: string[] = [];
    for (const b of content as Array<Record<string, unknown>>) {
      if (b.type === "tool_result") {
        const s = toolResultSummary(b);
        if (s) parts.push(s);
      }
    }
    return parts.length ? parts.join("\n") : null;
  }
  if (evt.type === "result") {
    const ok = evt.is_error !== true && evt.subtype === "success";
    return ok ? "✓ done" : `✗ ${String(evt.subtype ?? "error")}`;
  }
  return null;
}
