/**
 * Thinky chat SESSION type (2026-07-17) — "hack the chat to make it ours".
 *
 * Contract extracted from the shipped build (code-server 1.128, copilot-chat
 * v0.56 as the reference implementation):
 *  - `chatSessions` contribution declares the session type: our name, icon,
 *    welcome, input placeholder in the panel's agent picker.
 *  - `vscode.chat.createChatParticipant(<type>, handler)` is the session's
 *    request handler (participant id == session type).
 *  - `vscode.chat.registerChatSessionContentProvider(<type>, provider,
 *    participant)` (proposed API `chatSessionsProvider`, granted to
 *    thinkube.thinkube-tandem via product.json in the Thinkube image) serves
 *    session content; fresh sessions are `{history: [], requestHandler:
 *    undefined}` so requests route to the participant.
 *
 * The handler is the SAME chatCore used by @thinky — one seam, three mouths
 * (webview command field, @thinky mention, Thinky session).
 *
 * Everything is guarded: on a host without the API or without the proposal
 * grant, registration fails soft and the @thinky mention path still works.
 */

import * as vscode from "vscode";
import { getScratchpadSession } from "../session";
import { handleThinkyRequest, type ThinkySessionLike } from "./chatCore";

export const THINKY_SESSION_TYPE = "thinky";

export function registerThinkySession(
  context: vscode.ExtensionContext,
): void {
  const chatApi = (
    vscode as unknown as {
      chat?: {
        createChatParticipant?: (
          id: string,
          handler: (
            request: { prompt: string; command?: string },
            chatContext: unknown,
            stream: {
              markdown(value: string): void;
              button(button: {
                command: string;
                title: string;
                arguments?: unknown[];
              }): void;
            },
            token: unknown,
          ) => Promise<void>,
        ) => vscode.Disposable & { iconPath?: unknown };
        registerChatSessionContentProvider?: (
          type: string,
          provider: unknown,
          participant: unknown,
        ) => vscode.Disposable;
      };
    }
  ).chat;
  if (
    !chatApi?.createChatParticipant ||
    !chatApi.registerChatSessionContentProvider
  ) {
    return; // no session API in this host — the @thinky mention still works
  }

  try {
    const participant = chatApi.createChatParticipant(
      THINKY_SESSION_TYPE,
      async (request, _chatContext, stream, _token) => {
        const session = getScratchpadSession() as
          | ThinkySessionLike
          | undefined;
        await handleThinkyRequest(
          { prompt: request.prompt, command: request.command },
          session,
          stream,
        );
      },
    );
    participant.iconPath = new vscode.ThemeIcon("sparkle");
    context.subscriptions.push(participant);

    const provider = {
      async provideChatSessionContent(): Promise<unknown> {
        return { history: [], requestHandler: undefined };
      },
    };
    context.subscriptions.push(
      chatApi.registerChatSessionContentProvider(
        THINKY_SESSION_TYPE,
        provider,
        participant,
      ),
    );
  } catch {
    // Proposal not granted in this host (stock product.json) — ship dark.
  }
}
