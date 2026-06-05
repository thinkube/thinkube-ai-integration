---
uid: write-slices-and-moves-to-the-central-namespace
parent: SP-8
status: ready
depends_on:
  - SP-8_SL-1
satisfies:
  - 2
---
# Write slices and moves to the central namespace

Redirect the MCP write path (create_slice/move_slice and the provenance/verification stamps) to write under `<board-root>/<ns>/`, threading the code-repo root separately so git-coords/provenance still resolve against the Thinking Space's own repo (not the board dir).
Done: creating or moving a slice writes under the board root; `git status` in the code repo shows no `.thinkube/` change. (Satisfies AC #2.)
