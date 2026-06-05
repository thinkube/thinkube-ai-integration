---
uid: start-spec-in-worktree-gated-context-aware-from-
parent: SP-9
status: ready
parallel: true
satisfies:
  - 1
  - 2
---
# Start Spec in Worktree: gated, context-aware, from code repo

SpecsProvider computes hasOpenWork + carries the code repoPath on SpecNode + sets contextValue spec-open/spec-done; package.json gates the Start menu to spec-open; worktree.ts cuts the worktree from node.repoPath (not the sidecar) and prefixes /pair-start only when there's open work.
Done: the button shows only on Specs with open (Ready/Doing) slices and opens a /pair-start session on a worktree cut from the code repo; hidden on a done Spec. (Satisfies AC #1, #2.)
