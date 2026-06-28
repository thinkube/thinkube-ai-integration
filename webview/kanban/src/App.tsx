/**
 * Webview root. Sources the thinking space from the host on mount, provides it through
 * the (vendored-shape) GlobalContext, and persists local mutations back to the
 * host.
 */
import { useEffect, useState } from "react";
import { KanbanView } from "./components/kanban";
import { GlobalContext } from "./utils/context";
import { onHostMessage, postToHost } from "./utils/vscode";
import { ThinkingSpace, ModeFlag } from "./types";

const EMPTY_THINKING_SPACE: ThinkingSpace = {
  columns: [],
  tasks: {},
  scope: "",
};

export function App(): JSX.Element {
  const [thinkingSpace, setThinkingSpace] =
    useState<ThinkingSpace>(EMPTY_THINKING_SPACE);
  const [mode, setMode] = useState<ModeFlag>("both");

  useEffect(() => {
    const unsubscribe = onHostMessage((msg) => {
      if (msg.kind === "state" || msg.kind === "external-change") {
        setThinkingSpace(msg.thinkingSpace);
        setMode(msg.mode);
      }
    });
    postToHost({ kind: "load" });
    return unsubscribe;
  }, []);

  const setState = (next: ThinkingSpace) => {
    setThinkingSpace(next);
    postToHost({ kind: "save", thinkingSpace: next });
  };

  return (
    <GlobalContext.Provider value={{ state: thinkingSpace, setState }}>
      <KanbanView mode={mode} />
    </GlobalContext.Provider>
  );
}
