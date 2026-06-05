---
uid: retire-a-worktree-cleanly-pure-code-board-untouc
parent: SP-9
status: ready
parallel: true
satisfies:
  - 4
---
# Retire a worktree cleanly — pure code, board untouched

Verify (and trim any residual board assumption in) WorktreeService.remove: it removes the worktree's working dir refusing dirty/un-pushed work, and the sidecar board is untouched (the board no longer lives in the worktree).
Done: retiring a worktree removes it and leaves the Spec's board intact — no stranded card. (Satisfies AC #4.)
