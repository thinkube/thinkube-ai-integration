---
uid: graceful-board-repo-not-available-state
parent: SP-8
status: done
depends_on:
  - SP-8_SL-1
parallel: true
satisfies:
  - 6
verified_req_hash: 16a0c53e9dff89d8d5a6176b12909c6a22e2ea43
commit: cbf611e68fd9789672d203e67ade4f5504f85c2d
---

# Graceful "board repo not available" state

When the configured board root is absent or unmounted, the navigator and MCP surface a clear "board repo not available" state instead of showing nothing or erroring silently.
Done: with no board root present, the extension shows the clear "board repo not available" state rather than failing silently. (Satisfies AC #6.)
