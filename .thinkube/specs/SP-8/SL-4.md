---
uid: graceful-board-repo-not-available-state
parent: SP-8
status: ready
depends_on:
  - SP-8_SL-1
parallel: true
satisfies:
  - 6
---
# Graceful "board repo not available" state

When the configured board root is absent or unmounted, the navigator and MCP surface a clear "board repo not available" state instead of showing nothing or erroring silently.
Done: with no board root present, the extension shows the clear "board repo not available" state rather than failing silently. (Satisfies AC #6.)
