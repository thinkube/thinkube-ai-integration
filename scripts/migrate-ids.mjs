#!/usr/bin/env node
/**
 * migrate-ids — ONE-SHOT, THROWAWAY migration from the base36-epoch id scheme
 * to org-scoped sequential ids in a nested tree (SP-th8m5b / TEP-th8lzj).
 *
 * It rewrites a sidecar thinking space root in place:
 *
 *   OLD (flat, base36-epoch):                NEW (nested, sequential):
 *     <ns>/teps/TEP-<base36>.md                <ns>/<org>/teps/TEP-n/tep.md
 *     <ns>/specs/SP-<base36>/spec.md           <ns>/<org>/teps/TEP-n/SP-m/spec.md
 *     <ns>/specs/SP-<base36>/SL-k.md           <ns>/<org>/teps/TEP-n/SP-m/SL-k.md
 *
 * What it does, per (thinking space, org):
 *   1. Recover creation order: base36-epoch ids decode to epoch-seconds
 *      (`parseInt(id, 36)`), so sorting them ascending recovers when each TEP /
 *      spec was minted.
 *   2. Assign sequential numbers in that order — `TEP-1, TEP-2, …` per
 *      (namespace) and `SP-1, SP-2, …` per TEP — and **freeze** them into each
 *      file's frontmatter (`id:`) so a later delete never renumbers a survivor.
 *   3. Move every directory into the nested tree, inserting the `<org>` segment.
 *      A spec is co-located under the TEP it `implements:` — including across
 *      thinkingSpaces (a promoted project-umbrella TEP), so member specs nest under the
 *      project's tree (their code-repo identity stays in frontmatter `repo:`).
 *   4. Rewrite cross-refs so they still resolve: `implements:` (bare →
 *      `TEP-n`; qualified → `<ns>/<org>:TEP-n`), `implemented_by:` (→ `SP-m`),
 *      slice `parent:` (→ `SP-m`) and `depends_on:` (→ the tep-qualified
 *      `TEP-n_SP-m_SL-k` handle).
 *   5. Optionally rename the `spec/SP-<base36>` git branches (and their
 *      worktrees) in each `--repo` to the tep-qualified `spec/TEP-n_SP-m` form.
 *
 * Idempotent: a second run finds no flat `teps/TEP-*.md` files or `specs/SP-*`
 * dirs left to migrate and is a no-op.
 *
 * The `<org>` is derived from git `user.name` (sanitized) unless `--org` is
 * given; there is NO default — an unset/empty `user.name` fails fast.
 *
 *   node scripts/migrate-ids.mjs --thinking-space <thinkingSpaceRoot> [--org <org>] \
 *        [--repo <codeRepo>]... [--dry-run]
 *
 * Throwaway: delete once the live thinking space is converted.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

// ── argument parsing ──────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { thinkingSpace: undefined, org: undefined, repos: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--thinking-space") out.thinkingSpace = argv[++i];
    else if (a === "--org") out.org = argv[++i];
    else if (a === "--repo") out.repos.push(argv[++i]);
    else if (a === "--dry-run") out.dryRun = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!out.thinkingSpace) throw new Error("--thinking-space <thinkingSpaceRoot> is required");
  return out;
}

// ── org resolution (mirror of thinkingSpaceNamespace.containerSegment + fail-fast) ──
/** Sanitize a git user.name into a filesystem-safe org segment. */
export function sanitizeOrg(name) {
  return (name ?? "")
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/\s+/g, "-");
}

/** Resolve the org, failing fast (no default) when it can't be derived. */
function resolveOrg(explicit, thinkingSpaceRoot) {
  if (explicit !== undefined) {
    const seg = sanitizeOrg(explicit);
    if (!seg) throw new Error("--org was given but empty after sanitizing");
    return seg;
  }
  let userName = "";
  try {
    userName = execFileSync("git", ["config", "user.name"], {
      cwd: thinkingSpaceRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    userName = "";
  }
  const seg = sanitizeOrg(userName);
  if (!seg) {
    throw new Error(
      "Cannot resolve organization: git `user.name` is unset or empty. " +
        "Set it (`git config user.name <name>`) or pass --org — there is no default org.",
    );
  }
  return seg;
}

// ── frontmatter (mirror of src/store/frontmatter.ts, vscode-free) ──────────
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function splitFrontmatter(text) {
  const m = FM_RE.exec(text);
  if (!m) return { fm: undefined, body: text };
  let fm;
  try {
    const parsed = yamlParse(m[1]);
    fm =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
  } catch {
    fm = {};
  }
  return { fm, body: text.slice(m[0].length) };
}

function joinFrontmatter(fm, body) {
  if (!fm) return body ?? "";
  const yamlBlock = yamlStringify(fm, {
    sortMapEntries: false,
    lineWidth: 0,
  }).trimEnd();
  const sep = (body ?? "").startsWith("\n") ? "" : "\n";
  return `---\n${yamlBlock}\n---${sep}${body ?? ""}`;
}

// ── implements parsing (mirror of src/store/implementsRef.ts) ──────────────
/** Split an `implements:` on the LAST colon → { namespace?, id }. */
export function parseImplements(raw) {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  const idx = s.lastIndexOf(":");
  if (idx > 0) {
    return {
      namespace: s.slice(0, idx).trim(),
      id: s
        .slice(idx + 1)
        .trim()
        .replace(/^TEP-/i, ""),
    };
  }
  return { id: s.replace(/^TEP-/i, "") };
}

// ── id helpers ─────────────────────────────────────────────────────────────
/** Base36-epoch ids decode to epoch-seconds; sorting recovers creation order. */
function decodeEpoch(id) {
  const n = parseInt(id, 36);
  return Number.isFinite(n) ? n : 0;
}

const TEP_FILE_RE = /^TEP-([A-Za-z0-9]+)(?:-.*)?\.md$/; // flat (old), optional slug
const SPEC_DIR_RE = /^SP-([A-Za-z0-9]+)$/; // old spec folder
const SLICE_FILE_RE = /^SL-(\d+)\.md$/;
const TEMPLATE_FILE = "TEP-TEMPLATE.md"; // org-agnostic sentinel scaffold

// ── fs helpers ───────────────────────────────────────────────────────────
function readdirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** A namespace is "old-shaped" if it has flat TEP files or SP-* spec dirs. */
function oldTepFiles(nsDir) {
  return readdirSafe(path.join(nsDir, "teps"))
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => {
      const m = TEP_FILE_RE.exec(n);
      return m && m[1] !== "TEMPLATE";
    });
}

function oldSpecDirs(nsDir) {
  return readdirSafe(path.join(nsDir, "specs"))
    .filter((e) => e.isDirectory() && SPEC_DIR_RE.test(e.name))
    .map((e) => e.name);
}

/**
 * The org-agnostic `TEP-TEMPLATE.md` scaffold, if this namespace carries one.
 * It is NOT a maintainer's TEP: it must never be parsed as a numbered/epoch id
 * (the `oldTepFiles` scan already skips it) and must never be renumbered. The
 * migration relocates it to the FIXED thinking space-level path `<ns>/teps/TEP-TEMPLATE.md`
 * (NOT under `<org>/`), content untouched — its `TEP-NNNN` placeholder stays
 * intact so `write_tep` can keep scaffolding new TEPs after the cutover.
 */
function templateFile(nsDir) {
  for (const e of readdirSafe(path.join(nsDir, "teps")))
    if (e.isFile() && e.name === TEMPLATE_FILE) return e.name;
  return undefined;
}

const SKIP_DIRS = new Set([".git", "node_modules"]);

/** Discover every old-shaped namespace (thinking space / project) under the thinking space root. */
function discoverNamespaces(thinkingSpaceRoot) {
  const out = [];
  const walk = (dir, rel, depth) => {
    const hasTeps = oldTepFiles(dir).length > 0;
    const hasSpecs = oldSpecDirs(dir).length > 0;
    if (hasTeps || hasSpecs) {
      out.push({ rel, dir });
      return; // a namespace is a leaf — never descend into it
    }
    if (depth >= 8) return;
    for (const e of readdirSafe(dir)) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name))
        continue;
      walk(
        path.join(dir, e.name),
        rel ? `${rel}/${e.name}` : e.name,
        depth + 1,
      );
    }
  };
  walk(thinkingSpaceRoot, "", 0);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

// ── the migration ──────────────────────────────────────────────────────────
export function migrate(opts) {
  const thinkingSpaceRoot = path.resolve(opts.thinkingSpace);
  const org = resolveOrg(opts.org, thinkingSpaceRoot);
  const dryRun = !!opts.dryRun;
  const log = (...a) => console.log(...a);

  const namespaces = discoverNamespaces(thinkingSpaceRoot);
  if (namespaces.length === 0) {
    log("migrate-ids: nothing to migrate (no flat base36-epoch layout found).");
    return {
      org,
      namespaces: [],
      teps: 0,
      specs: 0,
      slices: 0,
      branchesRenamed: 0,
    };
  }

  // ── Pass 1: collect TEPs, assign sequential numbers per namespace ──
  // tepMap key: `${nsRel} ${oldId}` → { nsRel, oldId, newNum }
  const tepMap = new Map();
  const tepFilesByNs = new Map(); // nsRel → [{ oldId, file }]
  for (const ns of namespaces) {
    const teps = oldTepFiles(ns.dir).map((file) => ({
      oldId: TEP_FILE_RE.exec(file)[1],
      file,
    }));
    teps.sort(
      (a, b) =>
        decodeEpoch(a.oldId) - decodeEpoch(b.oldId) ||
        a.oldId.localeCompare(b.oldId),
    );
    teps.forEach((t, i) => {
      tepMap.set(`${ns.rel} ${t.oldId}`, {
        nsRel: ns.rel,
        oldId: t.oldId,
        newNum: i + 1,
      });
    });
    tepFilesByNs.set(ns.rel, teps);
  }

  // Synthetic umbrella TEP per namespace for pre-hierarchy "orphan" specs (no
  // `implements:`). Allocated lazily and numbered AFTER the namespace's real TEPs so
  // their numbering is never disturbed; the orphans stay in their home namespace.
  const dummyByNs = new Map(); // nsRel → newNum
  const ensureDummyTep = (nsRel) => {
    let num = dummyByNs.get(nsRel);
    if (num === undefined) {
      num = (tepFilesByNs.get(nsRel)?.length ?? 0) + 1;
      dummyByNs.set(nsRel, num);
    }
    return num;
  };

  // ── Pass 2: collect specs, resolve parent TEP, assign per-TEP numbers ──
  // specRec: { homeNsRel, oldId, dir, fm, body, refNamespace, refId, ownerNsRel,
  //            tepNewNum, newNum }
  const specs = [];
  const errors = [];
  for (const ns of namespaces) {
    for (const name of oldSpecDirs(ns.dir)) {
      const oldId = SPEC_DIR_RE.exec(name)[1];
      const dir = path.join(ns.dir, "specs", name);
      const docPath = path.join(dir, "spec.md");
      let fm, body;
      if (fs.existsSync(docPath)) {
        ({ fm, body } = splitFrontmatter(fs.readFileSync(docPath, "utf8")));
      } else {
        fm = {};
        body = "";
      }
      const ref = parseImplements(fm.implements);
      if (!ref) {
        // Orphan (no `implements:`) — a pre-hierarchy spec. Host it under the
        // namespace's synthetic dummy umbrella TEP so it migrates cleanly and stays
        // in its home namespace.
        specs.push({
          homeNsRel: ns.rel,
          oldId,
          dir,
          fm,
          body,
          refNamespace: undefined,
          refId: undefined,
          ownerNsRel: ns.rel,
          tepNewNum: ensureDummyTep(ns.rel),
          newNum: 0,
        });
        continue;
      }
      // (dead — the no-implements case is now handled above by the dummy umbrella)
      if (false) {
        errors.push(
          `Spec SP-${oldId} (${ns.rel}) has no \`implements:\` — cannot place it under a TEP.`,
        );
        continue;
      }
      const ownerNsRel = ref.namespace ?? ns.rel;
      const tep = tepMap.get(`${ownerNsRel} ${ref.id}`);
      if (!tep) {
        errors.push(
          `Spec SP-${oldId} (${ns.rel}) implements ${ref.namespace ? ref.namespace + ":" : ""}TEP-${ref.id}, ` +
            `but no such TEP was found to host it.`,
        );
        continue;
      }
      specs.push({
        homeNsRel: ns.rel,
        oldId,
        dir,
        fm,
        body,
        refNamespace: ref.namespace,
        refId: ref.id,
        ownerNsRel,
        tepNewNum: tep.newNum,
        newNum: 0, // assigned below
      });
    }
  }
  if (errors.length) {
    throw new Error("migrate-ids: cannot migrate —\n  " + errors.join("\n  "));
  }

  // Per (owner namespace, parent TEP) group, sort by epoch and assign SP-m.
  const groups = new Map(); // `${ownerNsRel} ${tepNewNum}` → specRec[]
  for (const s of specs) {
    const key = `${s.ownerNsRel} ${s.tepNewNum}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  for (const grp of groups.values()) {
    grp.sort(
      (a, b) =>
        decodeEpoch(a.oldId) - decodeEpoch(b.oldId) ||
        a.oldId.localeCompare(b.oldId),
    );
    grp.forEach((s, i) => (s.newNum = i + 1));
  }

  // specMap key: oldSpecId → specRec (base36-epoch spec ids are unique).
  const specMap = new Map();
  for (const s of specs) specMap.set(s.oldId, s);

  // Slice-handle remap: old `SP-<oldId>_SL-k` → new `TEP-n_SP-m_SL-k`.
  const sliceHandleMap = new Map();
  for (const s of specs) {
    for (const e of readdirSafe(s.dir)) {
      const m = SLICE_FILE_RE.exec(e.name);
      if (e.isFile() && m) {
        const k = m[1];
        sliceHandleMap.set(
          `SP-${s.oldId}_SL-${k}`,
          `TEP-${s.tepNewNum}_SP-${s.newNum}_SL-${k}`,
        );
      }
    }
  }

  // ── Body cross-reference rewrite ──────────────────────────────────────────
  // Old ids are globally unique (one cross-thinking space dup — SP-th4wqi — resolved by the
  // referencing file's namespace below), so prose references remap deterministically.
  // A reference to an entity in the SAME namespace as the file becomes the new
  // thinking space-local handle; a cross-namespace one is namespace-qualified so it stays
  // unambiguous. Applied as a post-pass over every `.md` write (Pass 3 builds them).
  const tepRefByOldId = new Map(); // oldTepId → { ns, num }
  for (const { nsRel, oldId, newNum } of tepMap.values())
    tepRefByOldId.set(oldId, { ns: nsRel, num: newNum });
  const specsByOldId = new Map(); // oldSpecId → specRec[] (≥2 only for a dup id)
  for (const s of specs) {
    const arr = specsByOldId.get(s.oldId) ?? [];
    arr.push(s);
    specsByOldId.set(s.oldId, arr);
  }
  const refLog = []; // { file, from, to } — samples + the cross-thinking space dup mentions
  let bodyRefsRewritten = 0;

  const qualTep = (ns, num, fileNs) =>
    ns === fileNs ? `TEP-${num}` : `${ns}/${org}:TEP-${num}`;
  const qualSpec = (s, fileNs) => {
    const h = `TEP-${s.tepNewNum}_SP-${s.newNum}`;
    return s.ownerNsRel === fileNs ? h : `${s.ownerNsRel}/${org}:${h}`;
  };
  const pickSpec = (oldId, fileNs) => {
    const arr = specsByOldId.get(oldId);
    if (!arr) return undefined;
    if (arr.length === 1) return arr[0];
    return arr.find((s) => s.ownerNsRel === fileNs) ?? arr[0]; // dup → prefer same ns
  };

  const rewriteBody = (text, fileNs, fileLabel) => {
    const note = (from, to) => {
      bodyRefsRewritten++;
      if (refLog.length < 30) refLog.push({ file: fileLabel, from, to });
    };
    // Slice handles first (longest), then bare spec codes, then TEP codes. Only a
    // token that resolves to a KNOWN old id is replaced — new short ids and unrelated
    // look-alikes fall through untouched.
    return text
      .replace(/\bSP-([a-z0-9]{4,8})_SL-(\d+)\b/g, (m, id, k) => {
        const s = pickSpec(id, fileNs);
        if (!s) return m;
        const to = `${qualSpec(s, fileNs)}_SL-${k}`;
        note(m, to);
        return to;
      })
      .replace(/\bSP-([a-z0-9]{4,8})\b/g, (m, id) => {
        const s = pickSpec(id, fileNs);
        if (!s) return m;
        const to = qualSpec(s, fileNs);
        note(m, to);
        return to;
      })
      .replace(/\bTEP-([a-z0-9]{4,8})\b/g, (m, id) => {
        const t = tepRefByOldId.get(id);
        if (!t) return m;
        const to = qualTep(t.ns, t.num, fileNs);
        note(m, to);
        return to;
      });
  };

  // ── Pass 3: compute every write/remove, then apply ──
  const writes = []; // { path, content }
  const removes = []; // dir paths
  const newSpecHandleById = new Map(); // oldSpecId → SP-m
  for (const s of specs) newSpecHandleById.set(s.oldId, `SP-${s.newNum}`);

  const rewriteImplementedBy = (list) => {
    if (!Array.isArray(list)) return list;
    return list.map((h) => {
      const m = /^SP-([A-Za-z0-9]+)$/.exec(String(h).trim());
      if (m && newSpecHandleById.has(m[1])) return newSpecHandleById.get(m[1]);
      return h;
    });
  };

  // TEPs (each stays in its home namespace, gains the <org> segment).
  for (const ns of namespaces) {
    for (const t of tepFilesByNs.get(ns.rel)) {
      const rec = tepMap.get(`${ns.rel} ${t.oldId}`);
      const { fm, body } = splitFrontmatter(
        fs.readFileSync(path.join(ns.dir, "teps", t.file), "utf8"),
      );
      const nfm = fm ?? {};
      nfm.id = `TEP-${rec.newNum}`; // frozen
      if (nfm.implemented_by)
        nfm.implemented_by = rewriteImplementedBy(nfm.implemented_by);
      const target = path.join(
        thinkingSpaceRoot,
        ...ns.rel.split("/").filter(Boolean),
        org,
        "teps",
        `TEP-${rec.newNum}`,
        "tep.md",
      );
      writes.push({ path: target, content: joinFrontmatter(nfm, body) });
    }
    // Synthetic dummy umbrella for this namespace's orphan specs, if any.
    const dummyNum = dummyByNs.get(ns.rel);
    if (dummyNum !== undefined) {
      const members = specs
        .filter((s) => s.ownerNsRel === ns.rel && s.tepNewNum === dummyNum)
        .sort((a, b) => a.newNum - b.newNum)
        .map((s) => `SP-${s.newNum}`);
      const dfm = {
        kind: "tep",
        id: `TEP-${dummyNum}`,
        status: "accepted",
        title: "Unfiled — pre-hierarchy specs",
        implemented_by: members,
      };
      const dbody =
        `# TEP-${dummyNum} — Unfiled (pre-hierarchy specs)\n\n` +
        `Synthetic umbrella created by the id migration to host specs that predate ` +
        `the TEP→Spec hierarchy (they had no \`implements:\`). Not a real proposal.\n`;
      writes.push({
        path: path.join(
          thinkingSpaceRoot,
          ...ns.rel.split("/").filter(Boolean),
          org,
          "teps",
          `TEP-${dummyNum}`,
          "tep.md",
        ),
        content: joinFrontmatter(dfm, dbody),
      });
    }
    removes.push(path.join(ns.dir, "teps"));
    removes.push(path.join(ns.dir, "specs"));
  }

  // Specs + their slices (placed under the TEP they implement).
  for (const s of specs) {
    const ownerSegs = s.ownerNsRel.split("/").filter(Boolean);
    const newSpecDirAbs = path.join(
      thinkingSpaceRoot,
      ...ownerSegs,
      org,
      "teps",
      `TEP-${s.tepNewNum}`,
      `SP-${s.newNum}`,
    );

    // spec.md
    const sfm = s.fm ?? {};
    sfm.id = `SP-${s.newNum}`; // frozen
    if (s.refNamespace === undefined) {
      sfm.implements = `TEP-${s.tepNewNum}`; // bare, local
    } else {
      // Qualified, cross-thinking space — deepen the namespace with the <org> segment.
      sfm.implements = `${s.refNamespace}/${org}:TEP-${s.tepNewNum}`;
    }
    // Cross-thinking space member (nested under another namespace's TEP — e.g. a project
    // umbrella): preserve its home code-repo identity in `repo:`, since the path now
    // encodes the project, not the repo. Realizes the contract this migration documents.
    if (s.homeNsRel !== s.ownerNsRel) sfm.repo = s.homeNsRel;
    writes.push({
      path: path.join(newSpecDirAbs, "spec.md"),
      content: joinFrontmatter(sfm, s.body),
    });

    // slices + any other sibling files
    for (const e of readdirSafe(s.dir)) {
      if (e.name === "spec.md") continue;
      const src = path.join(s.dir, e.name);
      if (e.isDirectory()) continue; // specs hold flat files; ignore stray dirs
      const m = SLICE_FILE_RE.exec(e.name);
      if (m) {
        const { fm, body } = splitFrontmatter(fs.readFileSync(src, "utf8"));
        const nfm = fm ?? {};
        nfm.parent = `SP-${s.newNum}`;
        if (Array.isArray(nfm.depends_on)) {
          nfm.depends_on = nfm.depends_on.map(
            (h) => sliceHandleMap.get(String(h).trim()) ?? h,
          );
        }
        writes.push({
          path: path.join(newSpecDirAbs, e.name),
          content: joinFrontmatter(nfm, body),
        });
      } else {
        // Preserve unknown sibling files verbatim.
        writes.push({
          path: path.join(newSpecDirAbs, e.name),
          content: fs.readFileSync(src),
        });
      }
    }
  }

  // decisions/ and retros/ — preserve them under the <org> segment (not renumbered).
  for (const ns of namespaces) {
    for (const sub of ["decisions", "retros"]) {
      const srcDir = path.join(ns.dir, sub);
      if (!fs.existsSync(srcDir)) continue;
      for (const e of readdirSafe(srcDir)) {
        if (!e.isFile()) continue;
        const target = path.join(
          thinkingSpaceRoot,
          ...ns.rel.split("/").filter(Boolean),
          org,
          sub,
          e.name,
        );
        writes.push({
          path: target,
          content: fs.readFileSync(path.join(srcDir, e.name)),
        });
      }
      removes.push(srcDir);
    }
  }

  // The org-agnostic TEP template — relocated to the FIXED thinking space-level path
  // (`<ns>/teps/TEP-TEMPLATE.md`, NOT under `<org>/`), bytes untouched. Applied
  // AFTER `removes` (which wipes the old `<ns>/teps`) so it survives the sweep,
  // and read as raw bytes so the `TEP-NNNN` placeholder is never reserialized.
  const templateWrites = [];
  for (const ns of namespaces) {
    const tf = templateFile(ns.dir);
    if (!tf) continue;
    templateWrites.push({
      path: path.join(
        thinkingSpaceRoot,
        ...ns.rel.split("/").filter(Boolean),
        "teps",
        TEMPLATE_FILE,
      ),
      content: fs.readFileSync(path.join(ns.dir, "teps", tf)),
    });
  }

  // Rewrite cross-references in every `.md` body. The file's namespace is the path
  // segment before the `<org>` segment (`<ns>/<org>/teps/…`); the template
  // (`<ns>/teps/TEP-TEMPLATE.md`, no `<org>`) has no id refs and is skipped.
  for (const w of writes) {
    if (!w.path.endsWith(".md")) continue;
    const segs = path.relative(thinkingSpaceRoot, w.path).split(path.sep);
    const oi = segs.indexOf(org);
    if (oi <= 0) continue;
    const fileNs = segs.slice(0, oi).join("/");
    const text = Buffer.isBuffer(w.content)
      ? w.content.toString("utf8")
      : w.content;
    w.content = rewriteBody(text, fileNs, path.relative(thinkingSpaceRoot, w.path));
  }

  // ── apply ──
  if (dryRun) {
    log(
      `migrate-ids (dry run): org=${org}, ${namespaces.length} namespace(s), ` +
        `${tepMap.size} TEP(s), ${specs.length} spec(s), ${sliceHandleMap.size} slice(s).`,
    );
    for (const w of writes) log(`  write  ${path.relative(thinkingSpaceRoot, w.path)}`);
    for (const r of removes) log(`  remove ${path.relative(thinkingSpaceRoot, r)}`);
    for (const w of templateWrites)
      log(`  keep   ${path.relative(thinkingSpaceRoot, w.path)} (template, unchanged)`);
    log(`  body-refs rewritten: ${bodyRefsRewritten}`);
    for (const r of refLog.slice(0, 20))
      log(`    ${r.file}: ${r.from} -> ${r.to}`);
    return {
      org,
      namespaces: namespaces.map((n) => n.rel),
      teps: tepMap.size,
      specs: specs.length,
      slices: sliceHandleMap.size,
      branchesRenamed: 0,
    };
  }

  for (const w of writes) {
    fs.mkdirSync(path.dirname(w.path), { recursive: true });
    fs.writeFileSync(w.path, w.content);
  }
  for (const r of removes) fs.rmSync(r, { recursive: true, force: true });
  // Re-lay the template AFTER the sweep so the wiped `<ns>/teps` can't clobber it.
  for (const w of templateWrites) {
    fs.mkdirSync(path.dirname(w.path), { recursive: true });
    fs.writeFileSync(w.path, w.content);
  }

  // ── Pass 4: rename git branches + worktrees (best-effort, per --repo) ──
  let branchesRenamed = 0;
  for (const repo of opts.repos ?? []) {
    for (const s of specs) {
      const oldBranch = `spec/SP-${s.oldId}`;
      const newBranch = `spec/TEP-${s.tepNewNum}_SP-${s.newNum}`;
      try {
        const exists = execFileSync(
          "git",
          ["-C", repo, "branch", "--list", oldBranch],
          {
            encoding: "utf8",
          },
        ).trim();
        if (!exists) continue;
        // Move the worktree dir first (if the branch is checked out in one).
        try {
          const wts = execFileSync(
            "git",
            ["-C", repo, "worktree", "list", "--porcelain"],
            {
              encoding: "utf8",
            },
          );
          const blocks = wts.split("\n\n");
          for (const b of blocks) {
            if (b.includes(`branch refs/heads/${oldBranch}`)) {
              const wtPath = (/worktree (.+)/.exec(b) || [])[1];
              if (wtPath) {
                const moved = path.join(
                  path.dirname(wtPath),
                  `TEP-${s.tepNewNum}_SP-${s.newNum}`,
                );
                if (path.resolve(wtPath) !== path.resolve(moved)) {
                  execFileSync(
                    "git",
                    ["-C", repo, "worktree", "move", wtPath, moved],
                    { stdio: "ignore" },
                  );
                }
              }
            }
          }
        } catch {
          /* no worktree / move unsupported — branch rename still proceeds */
        }
        execFileSync(
          "git",
          ["-C", repo, "branch", "-m", oldBranch, newBranch],
          { stdio: "ignore" },
        );
        branchesRenamed++;
      } catch {
        /* branch absent or rename refused — skip */
      }
    }
  }

  log(
    `migrate-ids: org=${org}, ${namespaces.length} namespace(s), ` +
      `${tepMap.size} TEP(s), ${specs.length} spec(s), ${sliceHandleMap.size} slice(s), ` +
      `${bodyRefsRewritten} body-ref(s) rewritten` +
      (opts.repos?.length ? `, ${branchesRenamed} branch(es) renamed` : "") +
      ".",
  );
  return {
    org,
    namespaces: namespaces.map((n) => n.rel),
    teps: tepMap.size,
    specs: specs.length,
    slices: sliceHandleMap.size,
    branchesRenamed,
  };
}

// ── CLI entrypoint (skipped when imported) ─────────────────────────────────
import { fileURLToPath } from "node:url";
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    migrate(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(`migrate-ids: ${err.message}`);
    process.exit(1);
  }
}
