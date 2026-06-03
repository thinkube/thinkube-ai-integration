# Lean methodology — execution plan

Planning doc (no code yet). The process-shape decisions are locked in **ADR-0003**
(Spec→Slice, file-backed cards, three columns, two gates); this is the execution
checklist to realise them in the bundle. Storage/engine work lives in
`files-first-kanban-plan.md` (ADR-0001).

## Locked shape (ADR-0003)

- **Two concrete tiers: Spec → Slice.** Epic/Story removed. Grouping above the Spec =
  `theme:` frontmatter tag + optional `roadmap.md`.
- **Slices are file-backed cards (card = Slice).** Each slice is a file with a
  structured `status:` field; `/slice` writes these files directly — no issue minting.
  State is parsed as data, not scraped from prose.
- **Slices are sized by coherence, not the clock** — "one change you verify-and-commit
  as a single done (one green)." Bounds: can't state one done → split; has its own AC →
  it's a Spec.
- **3 columns:** `Ready → Doing → Done` — slices flow these. Specs being authored are
  pre-board.
- **2 gates:** Ready entry = parent Spec has non-empty `## Acceptance Criteria`; Done =
  verifier green + the satisfied AC checked. Comment gate dropped.
- **6 skills:** `spec-prepare`, `slice`, `pair-start`, `pair-next`, `board`, `retro`
  (+ `methodology-context`, `repo-conventions`, agents).

## Guiding principle

Strip coordination overhead (team-shaped; pure tax solo); keep the quality spine
(value independent of team size). Drop the GitHub _issue_ backing, not the _card_;
size by coherence, not by the clock (clock-sizing was estimation machinery).

## Change inventory (`templates/methodology-bundle/`)

| File                                 | Action                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `skills/epic-new/`                   | **Remove.** No Epic tier.                                                                                                                                                      |
| `skills/story-new/`                  | **Remove.** No Story tier.                                                                                                                                                     |
| `skills/tasks-materialize/`          | **Remove.** Issue-minting gone; `/slice` writes slice files instead.                                                                                                           |
| `skills/pair-start-quick/`           | **Remove** — folded into an adaptive `pair-start`.                                                                                                                             |
| `skills/tasks-decompose/`            | **Rename → `slice`.** Write **slice files** (`status:` Ready, `parent:`, optional `depends_on`/`parallel`), sized by coherence not 1–3h; drop chunk-9/materialiser references. |
| `skills/methodology-context/`        | Rewrite: Spec→Slice model, coherence sizing, `theme:` grouping, 3-column table, 2-gate table; drop chunk-N language.                                                           |
| `skills/spec-prepare/`               | Derive AC **directly from the user** (no parent Story); keep four canonical sections; drop issue-mirror step.                                                                  |
| `skills/pair-start/`                 | Drop Epic/Story ancestry; load the Spec + its slices; adaptive (no separate quick skill).                                                                                      |
| `skills/pair-next/`                  | 3-column flow over slices; reviewer+verifier in one Done gate; remove comment-as-gate; read board from files.                                                                  |
| `skills/board/`                      | Three columns of slices; group by Spec / `theme:`; files-sourced.                                                                                                              |
| `skills/retro/`                      | Keep (already lean).                                                                                                                                                           |
| `skills/repo-conventions/`           | Keep (verifier's command source).                                                                                                                                              |
| `agents/reviewer`,`verifier`         | Adjust to run within the single Done gate; `explorer` unchanged.                                                                                                               |
| `CLAUDE.md`                          | Rewrite block: files-first source of truth, Spec→Slice, coherence sizing, file-backed cards, 3 columns, 2 gates, `theme:` grouping.                                            |
| `settings.json`                      | Keep safe deny-list; trim `gh project`/`sub-issue` allows (no longer used).                                                                                                    |
| `mcp.json`,`manifest.json`,`VERSION` | Drop removed skills + rename `tasks-decompose`→`slice` in manifest; bump VERSION.                                                                                              |

## Frontmatter / layout changes

- **Slice** (new file kind), e.g. `.thinkube/slices/SL-{n}.md`: `status:`
  (Ready/Doing/Done), `parent:` (Spec id), optional `depends_on:` / `parallel:`; body =
  slice description.
- **Spec** (`.thinkube/specs/SP-{n}.md`): gains `theme:` (string/tag). Keeps the four
  canonical sections. Drop GitHub `parent_issue`.
- `roadmap.md` (optional) for the written arc.

## Sequencing

1. **This pass = bundle prompts/shape only.** Reversible; no `src/` changes.
2. **Engine follows** (`files-first-kanban-plan.md` Phases 1–3): store gains a `slice`
   kind + `status:`/`theme:`, `ThinkubeFilesAdapter` reads slice files as cards,
   files-native MCP, 3-column/2-gate logic.
   - Coupling risk: until the engine catches up, the lean prompts describe 3 columns / 2
     gates over slice files while the MCP/panel may still enforce the old 6/3 over
     issues. Either accept temporary drift or do the prompt rewrite together with the
     gate/column engine change.

## What explicitly stays (untouched)

- The **verifier gate** — "no green = not done" (now also the definition of a slice).
- **AC-driven specs** — the four canonical sections.
- **Card-per-unit** — preserved, now file-backed slices.
- The **`explorer` / `reviewer` / `verifier` agents**.
- **`/retro`** and **`repo-conventions`**.
- The **safe permission deny-list** (`rm -rf`, force-push, publish, …).

## Open implementation details (minor)

- Slice file location: flat `.thinkube/slices/SL-{n}.md` (matches the existing per-kind
  dir pattern) vs nested `.thinkube/specs/SP-{n}/slices/`. Lean default: flat with
  `parent:`.
- Archiving Done slices to keep the tree lean (e.g. `.thinkube/slices/archive/`).
- `theme:` as free string vs. a controlled list — start free, formalise only if needed.
