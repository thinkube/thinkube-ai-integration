---
uid: migrate-an-existing-co-located-board-into-the-si
parent: SP-8
status: done
depends_on:
  - SP-8_SL-1
  - SP-8_SL-2
satisfies:
  - 4
  - 5
verified_req_hash: 16a0c53e9dff89d8d5a6176b12909c6a22e2ea43
commit: bbb39dd5475fb2920f43ac2fc137a632ed248dbe
---

# Migrate an existing co-located board into the sidecar

One-shot migration command: move `<repo>/.thinkube/` → `<board-root>/<ns>/`, committing the removal in the code repo and the addition in the board repo, and relocating the bundle stamp. The `.claude/`+`CLAUDE.md`+`.mcp.json` bundle files stay put.
Done: migrates a Thinking Space's board with no loss of specs/slices/retros/decisions; the repo's `.thinkube/` board is fully gone (no stub) and the migrated space still works — navigable and slice-movable via the namespace mapping. (Satisfies AC #4, #5.)
