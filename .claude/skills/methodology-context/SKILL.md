---
description: Tandem methodology vocabulary, hierarchy, and workflow. Loaded on demand by other bundle skills; not user-invocable.
disable-model-invocation: true
allowed-tools: []
thinkube-bundle: 0.0.1
---

# Tandem methodology context

A reference document loaded by other bundle skills (`/spec-prepare`, `/slice`, `/pair-start`, `/pair-next`, `/board`, `/retro`) when they need to ground themselves in the shared vocabulary. Don't invoke directly.

**Tandem** is a development methodology designed from scratch for a single human + one AI pair on a git repo. Two axioms shape everything below:

1. The team is **one human (navigator) + one AI (driver)** — not a group of humans.
2. The **committed git repo is the single source of truth _and_ the board**.

Consequences: the entire artifact set — specs, slices, **teps** (Tandem Enhancement Proposals), retros — lives as committed markdown in the **central Tandem sidecar board repo** (`thinkube-tandem`, TEP-0008), namespaced per Thinking Space — host-agnostic (the board repo can live on Gitea, GitHub, or offline; reinstall recovery is `git clone`). There is **no external issue tracker in the core loop**. "Done" is defined in two layers (TEP-0010): each **slice** is done by an **automated verifier** (fast, no human sign-off), and each **Spec** is done by a **single human acceptance gate** at the end — the human approves the assembled result and the automated re-verify passes, then the Spec's one PR merges. The per-slice automated greens stay; the spec-level human accept is the lightest sign-off, placed exactly where per-slice greens miss integration/UX regressions.

## Hierarchy: Spec → Slice

Two concrete tiers. Grouping above a Spec is a `theme:` frontmatter tag (plus an optional one-paragraph `roadmap.md`) — not a tier.

| Tier  | Lives at                 | Card?                 | Purpose                                                                              |
| ----- | ------------------------ | --------------------- | ------------------------------------------------------------------------------------ |
| Spec  | `specs/SP-{n}/spec.md`   | No — the document     | The documented unit of work: acceptance criteria, constraints, design, file plan.    |
| Slice | `specs/SP-{n}/SL-{m}.md` | Yes — flows the board | One coherent end-to-end change you verify-and-commit as a single "done" (one green). |

- A **Slice** is **vertical** — a coherent end-to-end behaviour that, once green, is demonstrable on its own — **not a layer or file** ("add the Redis store" is a fragment of a slice, not a slice). A slice is **not** a renamed atomic task; slicing by layer/file recreates the tiny-task soup the unit exists to prevent.
- A **Slice** is sized by **coherence, not the clock**. Bounds: if you can't state a single "done" for it → it's more than one slice, split it; if it has its own distinct acceptance criteria / design → it's not a slice, it's a **Spec**.
- A spike / investigation / "confirm X" with no verifiable output is **not a slice** (it has no single "done") — it belongs in the parent Spec's `## Design` / `## Constraints`.

## Card handle

The canonical handle for a slice is **`SP-{n}_SL-{m}`** — e.g. `SP-3_SL-42` — hyphen _within_ each id, underscore _joins_ them. Used identically in the filename, the board chip, your instructions ("work on `SP-3_SL-42`"), and my references back.

- Slices are numbered **per-Spec**: `SL-1`, `SL-2`… restart within each Spec, so a new Spec starts at `SL-1` and numbers stay small.
- Handles are **per-repo** — each repo's board has its own `SP-`/`SL-` sequences. `SP-3_SL-42` is unique within a board; across repos, qualify by repo ("`SP-3_SL-42` in the extension").

## Slice file shape

```
---
uid: <stable-internal-id>          # never changes; the board's own link key
parent: SP-3                       # the parent Spec
status: ready | doing | done | archived
theme: <optional grouping tag>
due: <optional yyyy-mm-dd>
priority: <optional P0|P1|P2|P3>
verified_req_hash: <stamped by /pair-next on verify>
depends_on: [SP-3_SL-7]            # optional
parallel: true                     # optional
---

{slice description — what the one coherent change is}
```

- `status:` **is** the board column — parsed as data, not scraped from prose.
- **Identity is the `uid`** (stable forever; the board links on it); the **handle `SP-{n}_SL-{m}`** is the human reference. Reparenting a slice renumbers its handle but not its `uid`.
- **Numbers are never reused.** A finished or abandoned slice is **archived** (`status: archived`, file kept) — never deleted — so the per-Spec `max+1` allocator can't collide.

## Spec body shape (canonical)

The four section headers are load-bearing — the quality gates and the staleness hash look for them by name:

```
# {spec title}

{one-paragraph summary}

## Acceptance Criteria

- [ ] criterion 1
- [ ] criterion 2

## Constraints

- perf / compat / security / deadline constraints

## Design

{1–3 paragraphs: approach + key data structures + integration seams}

## File Structure Plan

- `path/to/file.ts` — why
```

Acceptance criteria are elicited from the **user** during `/spec-prepare` — there is no parent Story to inherit them from.

## Three-column workflow

| Column | Meaning                                                                         |
| ------ | ------------------------------------------------------------------------------- |
| Ready  | The parent Spec is complete (gate passes); the slice is available to pull.      |
| Doing  | The pair is actively working this slice. Keep **one slice in flight per Spec**. |
| Done   | Verifier green for the slice, and the AC it satisfies is checked on the Spec.   |

A Spec still being authored (no AC yet) is pre-board; its slices don't exist until it's sliced.

## Quality gates (three; file checks + server-enforced)

| Transition             | Gate                                                                                                                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slice → Ready          | The slice's parent Spec has a non-empty `## Acceptance Criteria`.                                                                                                                                                                                  |
| Slice → Done           | Verifier green for the slice's change, and the AC it satisfies is checked on the Spec. **Reviewer + verifier both run inside this single gate** — no Review/Verify handoff columns.                                                                |
| Spec acceptance → Done | The acceptance card reaches Done only when **every slice is Done, every AC box is checked, and a human-accept is recorded** (`accept_spec`). The MCP server **refuses** otherwise, naming the blocker — like `move_slice` refuses an unchecked AC. |

The slice **is** the per-slice verification boundary — "one green," automated. The **Spec** has one more, human gate on top: acceptance (below). (The old "≥1 comment" gate is gone: there is no second human to hand off to.)

## Spec lifecycle: one branch, one PR, one acceptance gate (TEP-0010)

A Spec runs on **one branch** `spec/SP-{n}` (a worktree when specs run in parallel, TEP-0008); every slice lands as **commits on that branch**, and the Spec produces **exactly one PR** — no per-slice branch or PR. Slices execute **consecutively and autonomously**: the human defines the goal up front (the Spec + its acceptance criteria) and `/pair-next` runs the Ready slices through Doing→Done to completion **without pausing between them**. The **only** human gate is **acceptance**, at the end:

1. The AI **explains** the assembled implementation across the slices (ideally a real end-to-end demonstration).
2. The human **approves** (or sends it back) — the session's single bless point.
3. The AI runs the **acceptance card** (`accept_spec`: the automated all-ACs-checked + all-slices-Done re-verify).
4. On pass → the Spec's **one PR merges/closes**. Spec done.

The **acceptance card** is a spec-level card **auto-derived from the Spec's `## Acceptance Criteria`** (not hand-written) — the Spec graduating from document to a board card for its final step. It is the last card to reach Done. This re-introduces human sign-off **only at spec scope** — per-slice stays automated — because automated per-slice greens miss integration/UX regressions, and a bug can be _in an AC_ (so re-ticking boxes isn't enough; a human judging the assembled result is).

## Spec staleness (re-verify semantics)

A `done` slice goes **stale** when its parent Spec changes **substantively**:

- **`requirements` (substantive — marks slices stale):** edits to the Spec's `## Acceptance Criteria` text, `## Design`, or `## Constraints`.
- **`metadata` (non-substantive — never stale):** `status:`/column moves, theme/priority/due edits, **and AC checkbox toggles** (`- [ ]` ↔ `- [x]`) — which record completion, not a requirement change.

Staleness is a normalized hash of the Spec's requirement sections with checkbox state stripped. `/pair-next` stamps each verified slice with the spec requirement-hash it validated against (`verified_req_hash:` in the slice's frontmatter); a slice is stale when the current hash differs. A slice with no baseline is never flagged.

`/pair-next` resolves substantively-stale slices **before** starting the next one: after advancing the finished slice, it sweeps the active Spec, re-runs the `verifier` against the current Spec, and re-opens any stale slice. `/pair-start` surfaces stale slices when it loads a Spec's context.

## Per-project board

Each **Thinking Space**'s board lives in the **central Tandem sidecar repo** (`thinkube-tandem`, TEP-0008), under its namespace `<container>/<rel>/` derived from the workspace-folder layout (host-agnostic — never from a git remote). A Space is methodology-enabled **iff its namespace dir exists in the board repo** (located via `thinkube.boards.root`); there is no settings registry, and the extension never auto-enables. The **workspace navigator** discovers the Spaces across the open workspace folders and lets you move between the enabled boards. _(The co-located `.thinkube/` dir is deprecated — TEP-0008.)_

## Pair modes

- `navigator`: AI reads + proposes only; the human writes the board/files.
- `driver`: AI is leading; both can write.
- `both` (default): either party can write at will.

## Write authority

Inside an invoked skill, board bookkeeping — moving cards, checking the AC a slice satisfies, stamping provenance/verification — is the **AI's job**: it does it and **reports the result with evidence**. The human steers substance and **intervenes by exception**; the AI never asks the human to move a card or re-invoke a command merely to advance mechanics, and stops only at a marked **bless point**, a **gate refusal**, or a **failed precondition**. (In `navigator` mode this inverts per mode awareness — the AI proposes, the human writes.)

Within a Spec, the marked **bless point is acceptance** (TEP-0010) — there is no mid-spec pick-bless or per-slice move confirmation. `/pair-next` runs the Spec's slices to completion autonomously and stops for the human only to **approve the assembled Spec before it merges**. The two human inputs per Spec are **define** (the Spec + ACs, up front) and **accept** (at the end); everything between is the AI advancing mechanics + the human intervening by exception.

## Slice creation (`/slice`)

`/slice` decomposes a Spec into coherent slices, writing individual `specs/SP-{n}/SL-{m}.md` files **directly** — no issue minting, no checkbox-list intermediate, no GitHub API. It allocates the next per-Spec `SL-{m}` and refuses rows that have no single verifiable "done" (those go in the Spec, not on the board).

## Subagents

- **explorer** — read-only research: "what's in this codebase / how does it work today." Returns `file:line`; refuses any write.
- **reviewer** — adversarial diff review against the Spec's acceptance criteria.
- **verifier** — runs the repo's verification (per `repo-conventions` — tests, or `tsc --noEmit` + build where there's no suite). Gates a slice's move to **Done**.
