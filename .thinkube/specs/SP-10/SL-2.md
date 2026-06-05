---
uid: wire-the-extension-to-the-sidecar-workspace-root
parent: SP-10
status: ready
depends_on:
  - SP-10_SL-1
satisfies:
  - 2
  - 3
---
# Wire the extension to the sidecar (workspace root + setting)

Add a 4th { "name": "Tandem", "path": "{{board_repo_path}}" } folder to thinkube.code-workspace.j2, and "thinkube.boards.root": "{{board_repo_path}}" to vscode-settings.json.j2 (merged into User/settings.json via combine(recursive), preserving the user's keys).
Done: after the deploy, the generated thinkube.code-workspace has the Tandem root and User/settings.json sets thinkube.boards.root = /home/thinkube/thinkube-tandem. (Satisfies AC #2, #3.)
