---
kind: decision
id: ADR-0004
title: Position as a new methodology (not "lean agile") + naming and terminology
status: proposed
created: 2026-06-03
repo: thinkube/thinkube-ai-integration
---

# ADR-0004 — Positioning: a new methodology, with a coined name and minimal lexicon

## Status

**Proposed** — the positioning/thesis is firm; the specific *name* is a
recommendation pending the user's pick. Builds on ADR-0001/0002/0003.

## Context

ADR-0003 told the story as "stripping team ceremony from agile/scrum." That framing
is a strategic liability:

- **Positioned as a *subset* ("agile, pruned"), you are judged against the parent's
  completeness.** Purists measure you by what you removed ("no Epics? no WIP limits?
  that isn't kanban"), and you can't win because you've accepted their frame.
- **Positioned as *its own thing*, you are judged against your own coherence** — a
  winnable fight, because you set the rules.

The guardrail: "new" must be **earned**. A name on top of "scrum minus three things"
reads as rebranding — worse than honest pruning. It is defensible only if there is a
genuine, internally consistent idea underneath that is not mere subtraction.

There is. Re-derived from first principles, the subtractions in ADR-0003 are not
edits to scrum — they are **consequences of different axioms**.

## The thesis (what is genuinely new, and why it isn't scrum)

**Two axioms:**

1. The team is **one human + one AI pair** (not a group of humans).
2. The **committed git repo is the single source of truth _and_ the board** (not an
   external tracker).

**What falls out — derived, not pruned:**

| Scrum/kanban has…            | …because                            | A pair on a repo →                                   |
| ---------------------------- | ----------------------------------- | ---------------------------------------------------- |
| Epic/Story planning tiers    | divide & align work across people   | none needed — a pair doesn't split across people; Spec→Task suffices |
| External issue tracker / board | a shared place humans coordinate in | the repo *is* the board (axiom 2); tasks are files   |
| Review/Verify handoff columns | hand work between reviewer & verifier | one shared context — collapse to `Ready→Doing→Done`  |
| "≥1 comment" gate            | an async note for a human reviewer  | no second human → dropped                            |
| Human review = "done"        | humans sign off                     | the second teammate is a machine → **verifier gate**: done = green |

So the headline is not "agile, but lighter." It is: **what a development methodology
looks like when you design it from scratch for a human+AI pair on a git repo** —
where "done" is defined by an automated verifier rather than human sign-off, and the
entire artifact set (specs, tasks, decisions, retros) lives as committed files, so
the repo is simultaneously code, board, and memory.

Scrum/kanban assume a team of humans coordinating cadence and handoffs; this assumes
one human + one AI sharing one source of truth. **Different axioms → different
shape. Not a subset.** Nobody can say "you did scrum wrong" because it never claimed
to be scrum.

Bonus, specific to the AI angle: defining the method **positively** (a coherent own
thing) is also easier for Claude to execute than a diff. "Do scrum, except ignore
X/Y/Z" forces the model to hold a base framework plus exceptions and negate
correctly under load; a self-contained positive spec has no negation to mishandle.

## Decision

1. **Position it as a new methodology**, defined positively by the two axioms above —
   not as "lean agile."
2. **Coin one proper noun for the methodology** (high identity payoff, near-zero
   cost — a label, not a concept to learn).
3. **Coin sparingly beyond that** — only for the genuinely novel primitives. Keep
   standard terms for standard concepts, because both humans and (crucially) Claude
   parse them zero-shot; novel jargon must be re-taught each session and drifts.

### Proposed name (pick one — recommendation first)

- **Tandem** *(recommended)* — two riders, one machine, a pilot steering and a stoker
  driving power; maps exactly onto the existing navigator/driver modes and the
  human+AI pair. Real word → zero learning cost; ownable as a methodology name. Skills
  read naturally: `/tandem-start`, `/tandem-next`.
- **Duet** — two performers in sync. Clean, but collides with a recent large-vendor
  "Duet AI" product.
- **Cadence** — the steady pulse of the work loop; but "cadence" already carries agile
  baggage (release cadence).
- **Cairn** — a trail of stacked stones built as you go; evokes the committed repo as
  durable, reinstall-surviving record. Distinctive but more abstract; weaker on the
  *pair* idea.

Can stand alone or as **"Thinkube Tandem."**

### Lexicon audit (keep standard vs coin)

| Term            | Verdict          | Why                                                        |
| --------------- | ---------------- | --------------------------------------------------------- |
| Methodology name | **Coin** (Tandem) | Identity anchor; the one slam-dunk.                       |
| The pair loop   | **Coin** (apply name) | `/tandem-start` / `/tandem-next` — the novel activity.   |
| Spec, Task      | Keep             | Standard; Claude + humans parse free.                    |
| Acceptance Criteria | Keep         | Standard; load-bearing and well understood.             |
| Verify / verifier, Done, Ready, Doing | Keep | Standard; the verifier *gate* is the novel idea, not the word. |
| Board           | Keep             | Standard; "the board is the repo" is a principle, not a coined noun. |
| theme, roadmap  | Keep             | Plain words doing plain jobs.                            |
| navigator / driver / both | Keep   | Descriptive; map to the tandem pilot/stoker.            |

## Consequences

- The "you pruned X" critique dissolves; critique shifts to "is the new core real?",
  answered by the derivation table above.
- One coined name + applying it to the loop; everything else stays standard →
  discipline preserved, Claude comprehension preserved.
- `pair-start`/`pair-next` skills rename to the chosen name's prefix (cosmetic, do it
  with the bundle rewrite).
- Requires a short public "what is <Name>" thesis doc (the table above is its seed).

## Alternatives considered

- **Don't name it; keep "lean agile/kanban."** Rejected: invites the purist frame and
  judges us against scrum's completeness.
- **Coin a full dialect** (rename task/spec/review/etc.). Rejected: onboarding cost,
  credibility risk, and worse zero-shot comprehension for the AI executor.
