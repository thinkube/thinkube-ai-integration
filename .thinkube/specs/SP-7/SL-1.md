---
uid: board-handles-opaque-string-spec-ids
parent: SP-7
status: ready
satisfies:
  - 4
  - 5
  - 6
---
# Board handles opaque string Spec ids

Propagate Spec id `number → string`: nextSpecNumber returns a string (still max+1 for now); listSpecDirs + the MCP SLICE_PATH_RE/SLICE_HANDLE_RE + create_slice's `spec` param accept `[A-Za-z0-9]+`; card resolution routes through the string handle (numeric issueNumber → opaque surrogate, retiring decodeCardNumber for spec-id recovery); paletteForParent hashes the string; SpecsProvider/WorktreeService/worktree handle string ids; the bundle skills drop the "(integer)" wording.
Done: a hand-placed `SP-<string>` spec reads/addresses/moves on the board and existing SP-1…8 still work; typecheck + stdio harness green. (Satisfies AC #4, #5, #6.)
