---
uid: read-a-thinking-space-s-board-from-the-central-r
parent: SP-8
status: ready
satisfies:
  - 1
  - 3
---
# Read a Thinking Space's board from the central root

Add the `thinkube.boards.root` setting + env plumbing (KanbanMcpProvider/bundle.ts/vscodeStub), the host-agnostic namespace resolver (`<container>/<rel>` ↔ `<board-root>/<ns>/`), split ThinkubeStore's board-dir from repo-root, and redirect both discovery walks (navigator discoverRepos, MCP BoardRegistry) to enumerate boards under the central root.
Done: with boards at `<board-root>/<container>/<rel>/`, the navigator lists and opens each Thinking Space's board read from the central root — two spaces show together, labeled — nothing read from a co-located `.thinkube/`. (Satisfies AC #1, #3.)
