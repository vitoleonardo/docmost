import { createElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { useAgentRun } from "@/features/ai-assistant/hooks/use-agent-run.ts";
import {
  AgentRequestError,
  runAgentTask,
} from "@/features/ai-assistant/services/ai-assistant-service.ts";
import type {
  AgentEvent,
  IAgentRunRequest,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

vi.mock(
  "@/features/ai-assistant/services/ai-assistant-service.ts",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/features/ai-assistant/services/ai-assistant-service.ts")
    >()),
    runAgentTask: vi.fn(),
  }),
);

const runMock = vi.mocked(runAgentTask);

interface RunningTask {
  body: IAgentRunRequest;
  emit: (event: AgentEvent) => void;
  finish: () => void;
  signal: AbortSignal;
}

let tasks: RunningTask[] = [];

function mockStreamingRun() {
  tasks = [];
  runMock.mockImplementation(
    (body, onEvent, signal) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
        tasks.push({ body, signal, emit: onEvent, finish: resolve });
      }),
  );
}

function setup(store = createStore()) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store }, children);
  return { store, ...renderHook(() => useAgentRun(), { wrapper }) };
}

const PROPOSAL = {
  id: "prop-1",
  pageId: "page-1",
  pageTitle: "Urlaubsregelung",
  reason: "Tage geändert",
  added: 3,
  removed: 1,
};

afterEach(() => {
  runMock.mockReset();
});

describe("useAgentRun", () => {
  it("AGENT-AC65: a fresh store starts empty", () => {
    const { result } = setup();

    expect(result.current.run).toBeNull();
    expect(result.current.unavailable).toBe(false);
    expect(result.current.inProgressRefused).toBe(false);
  });

  it("AGENT-AC49: stores steps, the proposal and the end event of a run", async () => {
    mockStreamingRun();
    const { result } = setup();

    act(() => {
      void result.current.start("space-1", "IT", "Passe Urlaub an");
    });
    act(() => tasks[0].emit({ type: "run", runId: "run-1" }));
    act(() =>
      tasks[0].emit({
        type: "step",
        steps: 1,
        label: { kind: "search", query: "Urlaub", count: 2 },
      }),
    );
    act(() => tasks[0].emit({ type: "proposal", proposal: PROPOSAL }));
    await act(async () => {
      tasks[0].emit({
        type: "end",
        outcome: "finished",
        pagesRead: 1,
        message: null,
      });
      tasks[0].finish();
    });

    expect(tasks[0].body).toEqual({
      spaceId: "space-1",
      task: "Passe Urlaub an",
    });
    expect(result.current.run).toMatchObject({
      runId: "run-1",
      spaceId: "space-1",
      spaceName: "IT",
      stepCount: 1,
      steps: [{ kind: "search", query: "Urlaub", count: 2 }],
      proposals: [{ ...PROPOSAL, status: "open" }],
      status: "ended",
      end: { outcome: "finished", pagesRead: 1, message: null },
    });
    expect(result.current.isRunning).toBe(false);
  });

  it("AGENT-AC56: state persists after the component unmounts and remounts", () => {
    mockStreamingRun();
    const first = setup();
    act(() => {
      void first.result.current.start("space-1", "IT", "Aufgabe");
    });
    act(() => tasks[0].emit({ type: "run", runId: "run-1" }));
    first.unmount();

    const second = setup(first.store);

    expect(second.result.current.run).toMatchObject({
      runId: "run-1",
      task: "Aufgabe",
      status: "running",
    });
  });

  it("AGENT-AC64: cancel aborts the request and later events are not applied", async () => {
    mockStreamingRun();
    const { result } = setup();
    act(() => {
      void result.current.start("space-1", "IT", "Aufgabe");
    });

    await act(async () => result.current.cancel());
    act(() => tasks[0].emit({ type: "proposal", proposal: PROPOSAL }));

    expect(tasks[0].signal.aborted).toBe(true);
    expect(result.current.run?.status).toBe("cancelled");
    expect(result.current.run?.proposals).toEqual([]);
  });

  it("AGENT-AC66: after cancel a new start is allowed at once", async () => {
    mockStreamingRun();
    const { result } = setup();
    act(() => {
      void result.current.start("space-1", "IT", "Erste");
    });
    await act(async () => result.current.cancel());

    act(() => {
      void result.current.start("space-1", "IT", "Zweite");
    });

    expect(tasks).toHaveLength(2);
    expect(result.current.run).toMatchObject({
      task: "Zweite",
      status: "running",
    });
  });

  it("AGENT-AC69: a rejected request sets the unavailable flag and keeps no run", async () => {
    runMock.mockRejectedValue(new AgentRequestError("assistant_unavailable"));
    const { result } = setup();

    await act(async () => result.current.start("space-1", "IT", "Aufgabe"));

    expect(result.current.unavailable).toBe(true);
    expect(result.current.run).toBeNull();
    act(() => result.current.clearUnavailable());
    expect(result.current.unavailable).toBe(false);
  });

  it("AGENT-AC70: run_in_progress sets inProgressRefused", async () => {
    runMock.mockRejectedValue(new AgentRequestError("run_in_progress"));
    const { result } = setup();

    await act(async () => result.current.start("space-1", "IT", "Aufgabe"));

    expect(result.current.inProgressRefused).toBe(true);
    expect(result.current.unavailable).toBe(false);
    expect(result.current.run?.status).toBe("in_progress_refused");
  });

  it("AGENT-AC95: startFromStale starts the fixed task in the run's space", async () => {
    mockStreamingRun();
    const { result } = setup();
    act(() => {
      void result.current.start("space-1", "IT", "Erste");
    });
    await act(async () => {
      tasks[0].emit({
        type: "end",
        outcome: "finished",
        pagesRead: 0,
        message: null,
      });
      tasks[0].finish();
    });

    act(() => {
      void result.current.startFromStale(PROPOSAL);
    });

    expect(tasks[1].body).toEqual({
      spaceId: "space-1",
      task: "Erstelle einen neuen Vorschlag für die Seite „Urlaubsregelung“. Bisherige Begründung: Tage geändert",
    });
    expect(result.current.run?.spaceName).toBe("IT");
  });

  it("AGENT-AC115: two starts in a row send one request", () => {
    mockStreamingRun();
    const { result } = setup();

    act(() => {
      void result.current.start("space-1", "IT", "Aufgabe");
      void result.current.start("space-1", "IT", "Aufgabe");
    });

    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("AGENT-AC66: newTask clears the run and aborts a running request", () => {
    mockStreamingRun();
    const { result } = setup();
    act(() => {
      void result.current.start("space-1", "IT", "Aufgabe");
    });

    act(() => result.current.newTask());

    expect(tasks[0].signal.aborted).toBe(true);
    expect(result.current.run).toBeNull();
  });

  it("AGENT-AC49: setProposalStatus updates one proposal card", () => {
    mockStreamingRun();
    const { result } = setup();
    act(() => {
      void result.current.start("space-1", "IT", "Aufgabe");
    });
    act(() => tasks[0].emit({ type: "proposal", proposal: PROPOSAL }));

    act(() => result.current.setProposalStatus("prop-1", "applied"));

    expect(result.current.run?.proposals[0].status).toBe("applied");
  });
});
