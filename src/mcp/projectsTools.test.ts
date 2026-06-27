/**
 * Handler tests for list_projects / get_project (SP-tgvkmt_SL-2, reworked for
 * the structural-umbrella model in SP-tgvpbm_SL-2). installVscodeStub pattern
 * (stub imported FIRST); main() is require.main-guarded.
 *
 * Membership is now structural: a project's members are the specs whose
 * `implements:` resolves to one of the project's umbrella TEPs, plus their slices.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import {
  listProjects,
  getProject,
  createSlice,
  promoteTep,
} from "./kanbanMcpServer";

/** A tmp board root with two products; the `rebrand` project owns an umbrella TEP. */
function boardRootWithProjects(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-projbr-"));
  const proj = (rel: string, yaml: string) => {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
    fs.writeFileSync(path.join(root, rel, "project.yaml"), yaml);
  };
  proj("Platform/projects/rebrand", "name: The Rebrand\nstate: open\n");
  // The umbrella TEP the project owns.
  fs.mkdirSync(path.join(root, "Platform", "projects", "rebrand", "teps"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "Platform", "projects", "rebrand", "teps", "TEP-reb.md"),
    "---\nkind: tep\nid: TEP-reb\n---\n# Rebrand\n",
  );
  proj("Apps/projects/search", "name: Search\n");
  return root;
}

/**
 * A tmp board store with one Spec (given `implements`) that has acceptance
 * criteria. `spec` is the org-scoped composite `<tep>/<spec>` (numeric, so the
 * slice handle/path regexes resolve).
 */
async function seededStore(
  spec: string,
  implementsRef: string,
): Promise<ThinkubeStore> {
  const board = fs.mkdtempSync(path.join(os.tmpdir(), "tk-projstore-"));
  const store = new ThinkubeStore(board, board);
  await store.writeFile(
    store.pathForSpecDoc(spec),
    {
      implements: implementsRef,
      ac_verifications: { "1": { run: "npm test" } },
    },
    "# Demo\n\n## Acceptance Criteria\n\n- [ ] x\n",
  );
  return store;
}

test("list_projects returns every product's projects, sorted", () => {
  const res = listProjects({
    env: { boardRoot: boardRootWithProjects() },
  } as never) as { projects: { product: string; id: string }[] };
  assert.deepEqual(
    res.projects.map((p) => `${p.product}/${p.id}`),
    ["Apps/search", "Platform/rebrand"],
  );
});

test("get_project members = specs implementing the umbrella TEP + their slices (not tags)", async () => {
  const root = boardRootWithProjects();
  // member: implements the project's umbrella TEP via the qualified ref. Its
  // own org-tree home is TEP-1/SP-1 (where the file sits), independent of the
  // logical `implements:` link to the umbrella TEP-reb.
  const a = await seededStore("1/1", "Platform/projects/rebrand:TEP-reb");
  // non-member: implements something else.
  const b = await seededStore("2/1", "Apps/projects/other:TEP-zzz");
  const sl = (await createSlice(a, {
    spec: "1/1",
    title: "a member slice",
    body: "d",
  })) as { slice: string };

  const ctx = {
    env: { boardRoot: root },
    boards: {
      list: () => [
        { id: "A", worktree: false },
        { id: "B", worktree: false },
      ],
      resolve: (id: string) => (id === "A" ? a : b),
    },
  };
  const res = (await getProject(ctx as never, "Platform", "rebrand")) as {
    teps: string[];
    members: { handle: string; kind: string }[];
  };
  assert.deepEqual(res.teps, ["TEP-reb"]);
  const handles = res.members.map((m) => m.handle).sort();
  // the implementing spec (tep-qualified handle) + its (inherited) slice; the
  // non-member excluded.
  assert.deepEqual(handles, ["TEP-1_SP-1", sl.slice].sort());
  assert.ok(!handles.includes("TEP-2_SP-1"));
});

test("promote_tep moves the TEP and rewrites EVERY dependent (SP-tgvpbm_SL-3)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-promote-"));
  // The target project exists (empty teps/).
  fs.mkdirSync(path.join(root, "Platform", "projects", "rebrand"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "Platform", "projects", "rebrand", "project.yaml"),
    "name: Rebrand\n",
  );
  const mk = (ns: string) => {
    const bd = path.join(root, ...ns.split("/"));
    fs.mkdirSync(bd, { recursive: true });
    return new ThinkubeStore(bd, bd);
  };
  const origin = mk("Platform/core/thinkube");
  const control = mk("Platform/core/control");
  const ac = "## Acceptance Criteria\n\n- [ ] x\n";

  // TEP-reb lives in the origin repo board. Two on-disk forms are seeded for the
  // two code paths promote_tep exercises: (1) the org-tree nested `teps/TEP-reb/
  // tep.md` (via the store) is what `listTeps()` enumerates to LOCATE the origin
  // board, and (2) the flat `teps/TEP-reb.md` is what the move (renameSync) lifts
  // into the project's flat `teps/` (the project copy is a flat file —
  // discoverProjects/projectTeps read `<product>/projects/<id>/teps/TEP-<id>.md`).
  await origin.writeFile(
    origin.pathForTep("reb"),
    { kind: "tep", id: "TEP-reb" },
    "# Reb\n",
  );
  fs.writeFileSync(
    path.join(origin.thinkubeDir, "teps", "TEP-reb.md"),
    "---\nkind: tep\nid: TEP-reb\n---\n# Reb\n",
  );
  // SP-a (origin) implements TEP-reb bare; SP-b (other repo) implements it
  // qualified to origin; SP-c implements something else (non-dependent). The spec
  // ids are org-scoped composites `<tep>/<spec>` (numeric) — distinct per board so
  // their tep-qualified handles don't collide.
  await origin.writeFile(
    origin.pathForSpecDoc("1/1"),
    { implements: "TEP-reb" },
    `# A\n\n${ac}`,
  );
  await control.writeFile(
    control.pathForSpecDoc("2/1"),
    { implements: "Platform/core/thinkube:TEP-reb" },
    `# B\n\n${ac}`,
  );
  await control.writeFile(
    control.pathForSpecDoc("3/1"),
    { implements: "TEP-other" },
    `# C\n\n${ac}`,
  );

  const ctx = {
    env: { boardRoot: root },
    boards: {
      list: () => [
        { id: "O", worktree: false },
        { id: "C", worktree: false },
      ],
      resolve: (id: string) => (id === "O" ? origin : control),
    },
  };
  const res = (await promoteTep(
    ctx as never,
    "reb",
    "Platform",
    "rebrand",
  )) as {
    rewritten: string[];
  };

  // moved under the project; gone from the origin repo
  assert.ok(
    fs.existsSync(
      path.join(root, "Platform", "projects", "rebrand", "teps", "TEP-reb.md"),
    ),
  );
  assert.ok(
    !fs.existsSync(
      path.join(root, "Platform", "core", "thinkube", "teps", "TEP-reb.md"),
    ),
  );
  // EVERY dependent rewritten to the qualified umbrella ref; none dangling. The
  // rewritten handles are the new tep-qualified `TEP-<tep>_SP-<spec>` form.
  assert.deepEqual(res.rewritten.sort(), ["TEP-1_SP-1", "TEP-2_SP-1"]);
  const want = "Platform/projects/rebrand:TEP-reb";
  assert.equal(
    (await origin.getFile(origin.pathForSpecDoc("1/1")))?.frontmatter
      ?.implements,
    want,
  );
  assert.equal(
    (await control.getFile(control.pathForSpecDoc("2/1")))?.frontmatter
      ?.implements,
    want,
  );
  // non-dependent untouched
  assert.equal(
    (await control.getFile(control.pathForSpecDoc("3/1")))?.frontmatter
      ?.implements,
    "TEP-other",
  );
});

test("promote_tep refuses when the target project does not exist", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-promote-no-"));
  await assert.rejects(
    promoteTep(
      {
        env: { boardRoot: root },
        boards: { list: () => [], resolve: () => undefined },
      } as never,
      "reb",
      "Platform",
      "nope",
    ),
  );
});

test("get_project throws for an unknown project", async () => {
  await assert.rejects(
    getProject(
      {
        env: { boardRoot: boardRootWithProjects() },
        boards: { list: () => [], resolve: () => undefined },
      } as never,
      "Platform",
      "nope",
    ),
  );
});
