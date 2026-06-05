---
uid: 18-test-validates-the-board-repo-provisioning
parent: SP-10
status: ready
depends_on:
  - SP-10_SL-1
  - SP-10_SL-2
satisfies:
  - 4
---
# 18_test validates the board-repo provisioning

Add board_repo vars + three kubernetes.core.k8s_exec assertions to 18_test.yaml (reusing code_server_pod_info): the board repo dir exists (test -d {{board_repo_path}}), the workspace has the "Tandem" root (grep thinkube.code-workspace), and User/settings.json has thinkube.boards.root (grep).
Done: 18_test.yaml asserts all three and passes on a real run against the live code-server. (Satisfies AC #4.)
