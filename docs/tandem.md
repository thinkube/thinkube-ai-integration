# Tandem

**A development methodology for a team of two: one human, one AI — on a git repo.**

Tandem is not "agile, but lighter." It's what a methodology looks like when you
design it from scratch for a human pairing with an AI, where the repository itself
is the board. Most of agile's machinery exists to coordinate _people_; when the team
is one person and one model sharing one source of truth, that machinery isn't
trimmed away — it never needs to exist.

---

## Two axioms

Everything in Tandem follows from two starting assumptions:

1. **The team is one human + one AI pair.** Not a group of people.
2. **The committed git repo is the single source of truth _and_ the board.** Not an
   external tracker.

## What follows (not pruned — derived)

| A team methodology has…       | …because                                      | A pair on a repo gets…                                                          |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| Epic / Story planning tiers   | you divide and align work across people       | nothing extra — a pair doesn't split across people. **Spec → Slice** is enough. |
| An external issue tracker     | people need a shared place to coordinate      | the repo _is_ the board. Slices are committed files.                            |
| Review → Verify handoff lanes | work passes between a reviewer and a verifier | one shared context. Columns collapse to **Ready → Doing → Done**.               |
| Sign-off comments / approvals | an async record for the next human            | no second human → dropped.                                                      |
| "Done" = a human approves     | humans sign off on each other's work          | the second teammate is a machine that runs tests → **done = green**.            |
| Clock-sized, estimated tasks  | you forecast team velocity / sprint capacity  | no forecasting → slices are sized by **coherence, not the clock**.              |

So nobody can say "you did scrum wrong" — Tandem never claimed to be scrum. Different
axioms, different shape.

---

## How it works

**The hierarchy is two levels:**

- **Spec** — a deliverable unit. Carries the acceptance criteria, the design, and the
  file plan. It's the _document_.
- **Slice** — a coherent piece of work under a Spec. It's a _card_ on the board.

A slice is sized by coherence, not by a clock: **one change you verify-and-commit as a
single "done" — one green.** It might take an hour or a couple of days. You never split
work to hit a time box; you split only when it stops being one coherent outcome (and if
a piece grows its own acceptance criteria, it's not a slice — it's a Spec).

There are no Epics or Stories. To group related Specs (an "auth" push, a "billing"
effort), you tag them with a `theme:` and, if you want a narrative, jot a line in
`roadmap.md`. Grouping is metadata, not another tier to manage.

**The board is three columns — `Ready → Doing → Done` — and it lives in the repo.**
Each slice is a small file (`.thinkube/slices/SL-{n}.md`) whose `status:` field is its
column. Moving a card is a one-line edit and a commit. Clone the repo and you have the
whole board, history, and memory; there is nothing else to back up.

**The loop:**

1. `/spec-prepare` — talk through a Spec until it has real acceptance criteria.
2. `/slice` — break it into coherent slices, written as cards in `Ready`.
3. `/pair-start` — load the Spec and its slices; pick the next one.
4. `/pair-next` — the work pulse: verify the finished slice, advance the board, pull
   the next. Run it as often as you finish slices.
5. `/retro` — jot what you learned, whenever.

**Two gates, both checked from files:**

- A slice can enter **Ready** only if its parent Spec has real acceptance criteria.
- A slice is **Done** only when the verifier is green _and_ the acceptance criterion it
  satisfies is checked.

**One rule above all: no green = not done.** Tests, lint, and typecheck pass before a
slice moves — verified by a dedicated agent, with no override. This is the single
non-negotiable, and it's also what defines a slice: one green.

---

## The team of two

- **You** set direction and make the calls. A mode flag (`navigator` / `driver` /
  `both`) controls how much authority the AI has to move the board and edit files —
  like the pilot and stoker on a tandem bike.
- **Claude** is the pair: it drafts specs, slices them, writes code, and drives the
  loop. Three focused sub-agents keep it honest and keep context lean:
  - **explorer** — read-only codebase research; never writes.
  - **reviewer** — adversarial diff review against the acceptance criteria.
  - **verifier** — runs tests/lint/typecheck and returns pass/fail. Gates "Done."

---

## What Tandem deliberately leaves out

- **No external project tracker, no Projects v2, no per-slice issues.** The repo is the
  board, so it runs on Gitea, GitHub, GitLab, or fully offline — and survives a system
  reinstall, because the source of truth is just committed files.
- **No coordination ceremony** — no standups, no handoff columns, no sign-off comments.
  There's no second human to coordinate with.
- **No estimation** — no points, no clock-sizing, no velocity. Slices are sized by
  coherence, not forecast.
- **No invented dialect.** "Spec," "acceptance criteria," "verify," "done" mean what
  you already think — which also means your AI pair understands them with no
  instruction. The two coined words are the name on the box, _Tandem_, and _Slice_ —
  used because "task" wrongly implies a tiny, clock-sized to-do.

## Who it's for

A solo developer (or a very small, co-located one) who works closely with an AI and
lives in their editor and git. If you have a real team coordinating work across many
people and sprints, the ceremony Tandem removes is doing a job for you — use the team
tools. Tandem optimizes for the team of two.
