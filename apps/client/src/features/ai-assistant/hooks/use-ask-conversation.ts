import { useCallback } from "react";
import { atom, useAtomValue, useStore } from "jotai";
import { askQuestion, AskRequestError } from "@/features/ai-assistant/services/ai-assistant-service.ts";
import type {
  AskEvent,
  AskScope,
  AskTurnStatus,
  IAskConversation,
  IAskRequest,
  IAskTurn,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

const emptyConversation = (scope: AskScope): IAskConversation => ({
  conversationId: crypto.randomUUID(),
  scope,
  turns: [],
});

const askConversationAtom = atom<IAskConversation>(emptyConversation({ kind: "all" }));
const runningAskAtom = atom(null as AbortController | null);

function requestBodyOf(conversation: IAskConversation, question: string): IAskRequest {
  const { conversationId, scope } = conversation;
  const body: IAskRequest = { question, conversationId };
  if (scope.kind === "space") body.spaceId = scope.spaceId;
  if (scope.kind === "page") body.pageId = scope.pageId;
  return body;
}

export function useAskConversation() {
  const store = useStore();
  const conversation = useAtomValue(askConversationAtom);
  const { turns, scope } = conversation;
  const isPending = turns.at(-1)?.status === "streaming";

  const updateTurn = useCallback(
    (turnId: string, change: (turn: IAskTurn) => Partial<IAskTurn>) => {
      store.set(askConversationAtom, (current) => ({
        ...current,
        turns: current.turns.map((turn) =>
          turn.id === turnId ? { ...turn, ...change(turn) } : turn,
        ),
      }));
    },
    [store],
  );

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      const current = store.get(askConversationAtom);
      if (!text || current.turns.at(-1)?.status === "streaming") return;

      const turnId = crypto.randomUUID();
      const controller = new AbortController();
      store.set(runningAskAtom, controller);
      store.set(askConversationAtom, {
        ...current,
        turns: [
          ...current.turns,
          { id: turnId, question: text, answer: "", status: "streaming", sources: [] },
        ],
      });

      const finishWith = (status: AskTurnStatus, extra: Partial<IAskTurn> = {}) =>
        updateTurn(turnId, () => ({ status, ...extra }));

      const onEvent = (event: AskEvent) => {
        if (controller.signal.aborted) return;
        if (event.type === "delta") {
          updateTurn(turnId, (turn) => ({ answer: turn.answer + event.text }));
        } else if (event.type === "sources") {
          finishWith("done", { sources: event.sources });
        } else if (event.type === "no_source") {
          finishWith("no_source");
        } else {
          finishWith("error");
        }
      };

      try {
        await askQuestion(requestBodyOf(current, text), onEvent, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        const unavailable =
          error instanceof AskRequestError && error.code === "assistant_unavailable";
        finishWith(unavailable ? "unavailable" : "error");
      } finally {
        if (store.get(runningAskAtom) === controller) store.set(runningAskAtom, null);
      }
    },
    [store, updateTurn],
  );

  const stop = useCallback(() => {
    const controller = store.get(runningAskAtom);
    if (!controller) return;
    controller.abort();
    store.set(runningAskAtom, null);
    store.set(askConversationAtom, (current) => ({
      ...current,
      turns: current.turns.map((turn) =>
        turn.status === "streaming" ? { ...turn, status: "stopped" } : turn,
      ),
    }));
  }, [store]);

  const newConversation = useCallback(() => {
    store.get(runningAskAtom)?.abort();
    store.set(runningAskAtom, null);
    store.set(askConversationAtom, (current) => emptyConversation(current.scope));
  }, [store]);

  const setScope = useCallback(
    (next: AskScope) => {
      store.set(askConversationAtom, (current) => ({ ...current, scope: next }));
    },
    [store],
  );

  return { turns, scope, setScope, send, stop, newConversation, isPending };
}
