---
uid: spec-prepare-context-discipline
parent: SP-3
status: done
priority: P2
verified_req_hash: f5a9096998ff78fca2e50f567cc15638c4db2629
commit: a7196a51c6efbb6d1e9e83c142d18d8162484f07
---

# Fresh /spec-prepare reaches the user in ≤ 2 actions

Reorder the skill's procedure to fetch → skeleton → AC interview → scoped
exploration, and add the Context-discipline block (embedded shape is
authoritative — never read other specs for format; no uninstructed reads;
CLAUDE.md before codebase search; at most 2 actions before the first user
question). Bump the bundle so repos receive it. Done = a fresh
`/spec-prepare` run reaches its first question within 2 actions, with no
other-spec or board reads in the transcript.
