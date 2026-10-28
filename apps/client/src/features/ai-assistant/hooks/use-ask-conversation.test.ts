import { createElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { useAskConversation } from "@/features/ai-assistant/hooks/use-ask-conversation.ts";
import {
  AskRequestError,
  askQuestion,
} from "@/features/ai-assistant/services/ai-assistant-service.ts";
import type {
  AskEvent,
  IAskRequest,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

vi.mock("@/features/ai-assistant/services/ai-assistant-service.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai-assistant/services/ai-assistant-service.ts")>()),
  askQuestion: vi.fn(),
}));

const askMock = vi.mocked(askQuestion);

interface RunningAsk {
  body: IAskRequest;
  emit: (event: AskEvent) => void;
  finish: () => void;
  signal: AbortSignal;
}

let runs: RunningAsk[] = [];

function mockStreamingAsk() {
  runs = [];
  askMock.mockImplementation(
    (body, onEvent, signal) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
        runs.push({ body, signal, emit: onEvent, finish: resolve });
      }),
  );
}

async function answerWithNoSource(run: RunningAsk) {
  await act(async () => {
    run.emit({ type: "no_source" });
    run.finish();
  });
}

function setup(store = createStore()) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store }, children);
  return { store, ...renderHook(() => useAskConversation(), { wrapper }) };
}

const SOURCE = {
  number: 1,
  pageId: "p1",
  title: "T",
  spaceName: "IT",
  headingPath: [],
  fileName: null,
  pdfPage: null,
  url: "/s/it/p/t",
};

afterEach(() => {
  askMock.mockReset();
});

describe("useAskConversation", () => {
  it("ASK-AC51: a fresh store starts with no turns and scope all", () => {
    const { result } = setup();

    expect(result.current.turns).toEqual([]);
    expect(result.current.scope).toEqual({ kind: "all" });
    expect(result.current.isPending).toBe(false);
  });

  it("ASK-AC9: streams deltas into the turn and finishes with the sources", async () => {
    mockStreamingAsk();
    const { result } = setup();

    act(() => {
      void result.current.send("Frage?");
    });
    act(() => runs[0].emit({ type: "delta", text: "Ant" }));
    act(() => runs[0].emit({ type: "delta", text: "wort" }));

    expect(result.current.turns[0]).toMatchObject({
      question: "Frage?",
      answer: "Antwort",
      status: "streaming",
      sources: [],
    });
    expect(result.current.isPending).toBe(true);

    act(() => runs[0].emit({ type: "sources", sources: [SOURCE] }));
    await act(async () => runs[0].finish());

    expect(result.current.turns[0]).toMatchObject({ status: "done", sources: [SOURCE] });
    expect(result.current.isPending).toBe(false);
  });

  it("ASK-AC4: a no_source event ends the turn with status no_source", async () => {
    mockStreamingAsk();
    const { result } = setup();

    act(() => {
      void result.current.send("Frage?");
    });
    act(() => runs[0].emit({ type: "no_source" }));
    await act(async () => runs[0].finish());

    expect(result.current.turns[0]).toMatchObject({ status: "no_source", answer: "" });
  });

  it("ASK-AC66: an error event marks the turn error and keeps the partial text", async () => {
    mockStreamingAsk();
    const { result } = setup();

    act(() => {
      void result.current.send("Frage?");
    });
    act(() => runs[0].emit({ type: "delta", text: "Teil" }));
    act(() => runs[0].emit({ type: "error", code: "model_unavailable" }));
    await act(async () => runs[0].finish());

    expect(result.current.turns[0]).toMatchObject({ status: "error", answer: "Teil" });
  });

  it("ASK-AC66: assistant_unavailable marks the turn unavailable", async () => {
    askMock.mockRejectedValue(new AskRequestError("assistant_unavailable"));
    const { result } = setup();

    await act(async () => {
      await result.current.send("Frage?");
    });

    expect(result.current.turns[0].status).toBe("unavailable");
    expect(result.current.isPending).toBe(false);
  });

  it("ASK-AC66: other request errors mark the turn error", async () => {
    askMock.mockRejectedValue(new AskRequestError("space_not_found"));
    const { result } = setup();

    await act(async () => {
      await result.current.send("Frage?");
    });

    expect(result.current.turns[0].status).toBe("error");
  });

  it("ASK-AC11: a second send while the answer is streaming does nothing", async () => {
    mockStreamingAsk();
    const { result } = setup();

    act(() => {
      void result.current.send("Eins");
    });
    await act(async () => {
      await result.current.send("Zwei");
    });

    expect(askMock).toHaveBeenCalledTimes(1);
    expect(result.current.turns).toHaveLength(1);
  });

  it("ASK-AC11: a blank question is not sent", async () => {
    mockStreamingAsk();
    const { result } = setup();

    await act(async () => {
      await result.current.send("   ");
    });

    expect(askMock).not.toHaveBeenCalled();
    expect(result.current.turns).toEqual([]);
  });

  it("ASK-AC12: stop aborts, keeps the partial text and adds no sources", () => {
    mockStreamingAsk();
    const { result } = setup();

    act(() => {
      void result.current.send("Frage?");
    });
    act(() => runs[0].emit({ type: "delta", text: "Teil" }));
    act(() => result.current.stop());
    act(() => runs[0].emit({ type: "delta", text: " mehr" }));
    act(() => runs[0].emit({ type: "sources", sources: [SOURCE] }));

    expect(runs[0].signal.aborted).toBe(true);
    expect(result.current.turns[0]).toMatchObject({
      status: "stopped",
      answer: "Teil",
      sources: [],
    });
    expect(result.current.isPending).toBe(false);
  });

  it("ASK-AC12: a remounted hook can stop a running answer", () => {
    mockStreamingAsk();
    const first = setup();
    act(() => {
      void first.result.current.send("Frage?");
    });
    first.unmount();

    const second = setup(first.store);
    expect(second.result.current.isPending).toBe(true);
    act(() => second.result.current.stop());

    expect(runs[0].signal.aborted).toBe(true);
    expect(second.result.current.turns[0].status).toBe("stopped");
  });

  it("ASK-AC50: a new conversation aborts the answer, clears turns, renews the id and keeps the scope", async () => {
    mockStreamingAsk();
    const { result } = setup();
    act(() => result.current.setScope({ kind: "space", spaceId: "space-it" }));

    act(() => {
      void result.current.send("Eins");
    });
    const firstId = runs[0].body.conversationId;
    act(() => result.current.newConversation());

    expect(runs[0].signal.aborted).toBe(true);
    expect(result.current.turns).toEqual([]);
    expect(result.current.isPending).toBe(false);

    act(() => {
      void result.current.send("Zwei");
    });

    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0].question).toBe("Zwei");
    expect(runs[1].body.conversationId).not.toBe(firstId);
    expect(result.current.scope).toEqual({ kind: "space", spaceId: "space-it" });
  });

  it("ASK-AC50: follow-up questions reuse the conversation id", async () => {
    mockStreamingAsk();
    const { result } = setup();

    act(() => {
      void result.current.send("Eins");
    });
    await answerWithNoSource(runs[0]);
    act(() => {
      void result.current.send("Zwei");
    });

    expect(runs[1].body.conversationId).toBe(runs[0].body.conversationId);
  });

  it("ASK-AC8: the scope is mapped to spaceId or pageId in the request", async () => {
    mockStreamingAsk();
    const { result } = setup();

    act(() => {
      void result.current.send("a");
    });
    await answerWithNoSource(runs[0]);
    act(() => result.current.setScope({ kind: "space", spaceId: "s1" }));
    act(() => {
      void result.current.send("b");
    });
    await answerWithNoSource(runs[1]);
    act(() => result.current.setScope({ kind: "page", pageId: "p1" }));
    act(() => {
      void result.current.send("c");
    });

    expect(runs[0].body).toEqual({ question: "a", conversationId: expect.any(String) });
    expect(runs[1].body).toMatchObject({ spaceId: "s1" });
    expect(runs[1].body).not.toHaveProperty("pageId");
    expect(runs[2].body).toMatchObject({ pageId: "p1" });
    expect(runs[2].body).not.toHaveProperty("spaceId");
  });

  it("ASK-AC8: the scope survives unmount and remount", () => {
    const first = setup();
    act(() => first.result.current.setScope({ kind: "space", spaceId: "space-it" }));
    first.unmount();

    const second = setup(first.store);

    expect(second.result.current.scope).toEqual({ kind: "space", spaceId: "space-it" });
  });

  it("ASK-AC52: turns survive unmount and remount", async () => {
    mockStreamingAsk();
    const first = setup();
    act(() => {
      void first.result.current.send("Frage?");
    });
    act(() => runs[0].emit({ type: "delta", text: "Antwort" }));
    act(() => runs[0].emit({ type: "sources", sources: [SOURCE] }));
    await act(async () => runs[0].finish());
    first.unmount();

    const second = setup(first.store);

    await waitFor(() =>
      expect(second.result.current.turns[0]).toMatchObject({
        question: "Frage?",
        answer: "Antwort",
        status: "done",
      }),
    );
  });

  it("ASK-AC51: a new store (reload) holds none of the earlier turns", async () => {
    mockStreamingAsk();
    const first = setup();
    act(() => {
      void first.result.current.send("Frage?");
    });
    await act(async () => runs[0].finish());
    first.unmount();

    const reloaded = setup();

    expect(reloaded.result.current.turns).toEqual([]);
  });
});
