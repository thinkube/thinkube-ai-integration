---
uid: slice-context-discipline
parent: SP-3
status: done
depends_on:
  - SP-3_SL-1
priority: P2
verified_req_hash: f5a9096998ff78fca2e50f567cc15638c4db2629
commit: a7196a51c6efbb6d1e9e83c142d18d8162484f07
---

# /slice scopes exploration to the parent Spec

Add the Context-discipline block to /slice: the parent Spec's Design and
File Structure Plan are the scope — exploration exists only to validate the
file plan against reality, never to re-derive what spec.md and CLAUDE.md
already state; CLAUDE.md before any codebase search. Bump the bundle.
Done = a fresh `/slice` run reads nothing beyond the spec + targeted
validation before its proposal appears in chat.
