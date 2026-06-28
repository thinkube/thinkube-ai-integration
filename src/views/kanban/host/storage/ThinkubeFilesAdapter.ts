/**
 * ThinkubeFilesAdapter — the files-first kanban storage (ADR-0001/0007).
 *
 * Renders the thinking space *over* committed `.thinkube/specs/SP-{n}/SL-{m}.md` slice
 * files via `ThinkubeStore`, behind the existing `StorageAdapter` interface.
 * The GitHub-only optional methods (`createTask`, `setParent`, `promoteToChain`,
 * `listParentSpecs`) are deliberately omitted — they encode the spine being
 * retired; proper slice creation arrives with the trimmed interface + `/slice`
 * (migration phases 5–7). Until then this adapter exists alongside the
 * GitHub-backed one (additive expand-contract); wiring it as the thinking space's source
 * is Phase 6.
 *
 * The pure projection (slice → Thinking Space, id synthesis, status↔column, staleness)
 * lives in `sliceThinkingSpace.ts` and is unit-tested; this file is the I/O wrapper.
 */
import * as vscode from "vscode";

import { ThinkingSpace } from "../types";
import { StorageAdapter } from "../StorageAdapter";
import { ThinkubeStore } from "../../../../store/ThinkubeStore";
import type { Frontmatter } from "../../../../store/frontmatter";
import { requirementHash } from "../../../../methodology/specChange";
import { stampOnEnteringDone } from "../../../../github/sliceProvenance";
import { buildCommitUrl, detectRepoCoords } from "../../../../github/gitRemote";
import {
  buildSliceThinkingSpace,
  columnIdToStatus,
  deriveSpecMeta,
  SliceInput,
  SpecMeta,
} from "./sliceThinkingSpace";

// Org-scoped tree path: `<org>/teps/TEP-n/SP-m/SL-k.md` → [_, tep, spec, slice].
const SLICE_PATH_RE = /teps\/TEP-(\d+)\/SP-(\d+)\/SL-(\d+)\.md$/;

export class ThinkubeFilesAdapter implements StorageAdapter {
  private readonly _onExternalChange = new vscode.EventEmitter<ThinkingSpace>();
  readonly onExternalChange = this._onExternalChange.event;
  private storeSub: vscode.Disposable | undefined;

  constructor(
    private readonly store: ThinkubeStore,
    readonly scope: string,
    /** When set, the thinking space is scoped to a single Spec (its slices + meta only). */
    private readonly specFilter?: string,
    /** Display title — the thinking space name (falls back to scope). */
    private readonly spaceName?: string,
  ) {}

  /** This thinking space's identity, so a command triggered from the panel (the ▶ orchestrate button)
   *  acts on THIS thinking space rather than the ambient sidebar selection. */
  thinkingSpaceContext(): { root: string; thinkingSpaceDir: string; name: string } {
    return {
      root: this.store.workspaceRoot,
      thinkingSpaceDir: this.store.thinkubeDir,
      name: this.spaceName ?? this.scope,
    };
  }

  /** Begin reflecting external `.thinkube/` edits into the thinking space. Idempotent. */
  watchExternal(): void {
    if (this.storeSub) return;
    this.storeSub = this.store.onChanged((c) => {
      if (c.kind === "slice" || c.kind === "spec") void this.fireReload();
    });
  }

  dispose(): void {
    this.storeSub?.dispose();
    this.storeSub = undefined;
    this._onExternalChange.dispose();
  }

  async load(): Promise<ThinkingSpace> {
    // Per-Spec requirement-hash + acceptance-card readiness, computed once per
    // Spec (specs are few).
    const reqHashBySpec = new Map<string, string>();
    const specMeta = new Map<string, SpecMeta>();
    let subtitle: string | undefined;
    const specDirs = this.specFilter
      ? [this.specFilter]
      : await this.store.listSpecDirs();
    for (const specId of specDirs) {
      const doc = await this.store.getFile(this.store.pathForSpecDoc(specId));
      // Key meta by the tep-qualified spec key (`TEP-n_SP-m`) so it matches the
      // projection's `specKeyOf` — bare SP-m repeats across TEPs.
      const [tep, sp] = specId.split("/");
      const key = `TEP-${tep}_SP-${sp}`;
      if (doc?.body) reqHashBySpec.set(key, requirementHash(doc.body));
      specMeta.set(key, deriveSpecMeta(doc?.frontmatter, doc?.body));
      if (this.specFilter && specId === this.specFilter) {
        const h = doc?.body ? /^#\s+(.+)$/m.exec(doc.body) : null;
        subtitle = h?.[1]?.trim() || undefined;
      }
    }

    // Resolve the repo coords once so a recorded commit SHA can be turned into
    // a clickable URL. Undefined when not a GitHub remote — `commit` still
    // renders, just without a link.
    const coords = await detectRepoCoords(this.store.workspaceRoot);

    const inputs: SliceInput[] = [];
    for (const rel of await this.store.listSlices(this.specFilter)) {
      const m = SLICE_PATH_RE.exec(rel);
      if (!m) continue;
      const tepNumber = Number(m[1]);
      const specNumber = m[2];
      const sliceNumber = Number(m[3]);
      const specKey = `TEP-${tepNumber}_SP-${specNumber}`;
      const parsed = await this.store.getFile(rel);
      const fm: Frontmatter = parsed?.frontmatter ?? {};
      const { title, detail } = splitSlice(
        parsed?.body,
        `${specKey}_SL-${sliceNumber}`,
      );
      inputs.push({
        specNumber,
        tepNumber,
        sliceNumber,
        title,
        body: detail,
        status: fm.status,
        due: fm.due,
        priority: fm.priority,
        stampedReqHash: fm.verified_req_hash,
        currentReqHash: reqHashBySpec.get(specKey),
        commit: fm.commit,
        commitUrl:
          fm.commit && coords ? buildCommitUrl(coords, fm.commit) : undefined,
        pr: fm.pr,
        parallelGroup: fm.parallel_group,
        assignee: fm.assignee,
        files: fm.files,
        dependsOn: Array.isArray(fm.depends_on) ? fm.depends_on : undefined,
        workUnits: Array.isArray(fm.work_units) ? fm.work_units : undefined,
      });
    }
    const thinkingSpace = buildSliceThinkingSpace(inputs, this.scope, specMeta);
    thinkingSpace.title = this.spaceName ?? this.scope;
    thinkingSpace.subtitle = subtitle;
    return thinkingSpace;
  }

  async save(thinkingSpace: ThinkingSpace): Promise<void> {
    // Write-through: persist each card's column as its slice `status:`. Only
    // files whose status actually changed are rewritten.
    for (const card of Object.values(thinkingSpace.tasks)) {
      const ref = this.refForCard(card.id);
      if (!ref) continue;
      const rel = this.store.pathForSlice(ref.specNumber, ref.sliceNumber);
      const parsed = await this.store.getFile(rel);
      if (!parsed) continue;
      const target = columnIdToStatus(card.columnId);
      if (parsed.frontmatter?.status === target) continue;
      const fm: Frontmatter = { ...(parsed.frontmatter ?? {}), status: target };
      // Entering Done (status changed, so prior status wasn't "done"): record
      // delivery provenance, mirroring the MCP move_slice seam. Best-effort —
      // a git/gh failure must never block the drag.
      if (target === "done") {
        try {
          await stampOnEnteringDone(fm, this.store.workspaceRoot);
        } catch (err) {
          console.warn(
            `[thinkube] provenance stamp for ${rel} failed: ${(err as Error).message}`,
          );
        }
      }
      await this.store.writeFile(rel, fm, parsed.body);
    }
  }

  async updateIssue(
    id: string,
    fields: { title?: string; body?: string },
  ): Promise<void> {
    const ref = this.refForCard(id);
    if (!ref) return;
    const rel = this.store.pathForSlice(ref.specNumber, ref.sliceNumber);
    const parsed = await this.store.getFile(rel);
    if (!parsed) return;
    await this.store.writeFile(
      rel,
      parsed.frontmatter,
      composeSliceBody(parsed.body, fields),
    );
  }

  async setDueDate(id: string, date: string | null): Promise<void> {
    const ref = this.refForCard(id);
    if (!ref) return;
    const rel = this.store.pathForSlice(ref.specNumber, ref.sliceNumber);
    const parsed = await this.store.getFile(rel);
    if (!parsed) return;
    const fm: Frontmatter = { ...(parsed.frontmatter ?? {}) };
    if (date) fm.due = date;
    else delete fm.due;
    await this.store.writeFile(rel, fm, parsed.body);
  }

  /** Resolve a card to its (spec, slice) by parsing its string handle. */
  private refForCard(
    id: string,
  ): { specNumber: string; sliceNumber: number } | undefined {
    // Tep-qualified handle `TEP-n_SP-m_SL-k` → composite spec id `n/m`.
    const m = /^TEP-(\d+)_SP-(\d+)_SL-(\d+)$/.exec(id);
    if (m) return { specNumber: `${m[1]}/${m[2]}`, sliceNumber: Number(m[3]) };
    // Legacy flat handle `SP-{id}_SL-{m}`.
    const lm = /^SP-([A-Za-z0-9]+)_SL-(\d+)$/.exec(id);
    if (lm) return { specNumber: lm[1], sliceNumber: Number(lm[2]) };
    return undefined;
  }

  private async fireReload(): Promise<void> {
    this._onExternalChange.fire(await this.load());
  }
}

/**
 * Split a slice body into card title + detail. Canonical shape (the /slice
 * skill writes it): `# <short title>` then the detail paragraphs. The title
 * line is REMOVED from the detail so the card never shows it twice, and
 * over-long titles (legacy one-paragraph slices) are clipped for display —
 * the file keeps the full text.
 */
function splitSlice(
  body: string | undefined,
  fallback: string,
): { title: string; detail?: string } {
  if (!body) return { title: fallback };
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/^#+\s*/, "").trim();
    if (t) {
      const detail = lines
        .slice(i + 1)
        .join("\n")
        .trim();
      return { title: clipTitle(t), detail: detail || undefined };
    }
  }
  return { title: fallback };
}

/** Clip a display title at a word boundary; the file keeps the full text. */
function clipTitle(title: string, max = 80): string {
  if (title.length <= max) return title;
  const cut = title.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${at > 40 ? cut.slice(0, at) : cut}…`;
}

/**
 * Recompose a slice body from inline card edits. The card splits the file
 * into title (first non-empty line) and detail (the rest), so edits arrive
 * in pieces and must be stitched back around the part that didn't change —
 * a body edit must never drop the title line, nor vice versa.
 */
function composeSliceBody(
  oldBody: string,
  fields: { title?: string; body?: string },
): string {
  const lines = oldBody.split(/\r?\n/);
  let idx = -1;
  let marker = "# ";
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      idx = i;
      marker = /^(#+\s*)/.exec(lines[i])?.[1] ?? "";
      break;
    }
  }
  const oldTitle = idx >= 0 ? lines[idx].replace(/^#+\s*/, "").trim() : "";
  const title = fields.title ?? oldTitle;
  const detail =
    fields.body !== undefined
      ? fields.body.trim()
      : idx >= 0
        ? lines
            .slice(idx + 1)
            .join("\n")
            .trim()
        : "";
  const titleLine = `${marker}${title}`;
  return detail ? `${titleLine}\n\n${detail}\n` : `${titleLine}\n`;
}
