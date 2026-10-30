import { useCallback } from "react";
import { atom, useAtomValue, useStore } from "jotai";
import {
  AgentRequestError,
  runAgentTask,
} from "@/features/ai-assistant/services/ai-assistant-service.ts";
import type {
  AgentEvent,
  AgentProposalStatus,
  IAgentProposalSummary,
  IAgentRun,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

const agentRunAtom = atom(null as IAgentRun | null);
const agentUnavailableAtom = atom(false);
const runningAgentAtom = atom(null as AbortController | null);

function staleTaskOf(
  proposal: Pick<IAgentProposalSummary, "pageTitle" | "reason">,
): string {
  return `Erstelle einen neuen Vorschlag für die Seite „${proposal.pageTitle}“. Bisherige Begründung: ${proposal.reason}`;
}

function applyEvent(run: IAgentRun, event: AgentEvent): IAgentRun {
  if (event.type === "run") return { ...run, runId: event.runId };
  if (event.type === "step") {
    return {
      ...run,
      steps: [...run.steps, event.label],
      stepCount: event.steps,
    };
  }
  if (event.type === "proposal") {
    return {
      ...run,
      proposals: [...run.proposals, { ...event.proposal, status: "open" }],
    };
  }
  return {
    ...run,
    status: event.outcome === "model_failed" ? "failed" : "ended",
    end: {
      outcome: event.outcome,
      pagesRead: event.pagesRead,
      message: event.message,
    },
  };
}

function markCancelled(run: IAgentRun): IAgentRun {
  return run.status === "running" ? { ...run, status: "cancelled" } : run;
}

export function useAgentRun() {
  const store = useStore();
  const run = useAtomValue(agentRunAtom);
  const unavailable = useAtomValue(agentUnavailableAtom);

  const updateRun = useCallback(
    (update: (current: IAgentRun) => IAgentRun) => {
      store.set(agentRunAtom, (current) =>
        current ? update(current) : current,
      );
    },
    [store],
  );

  const start = useCallback(
    async (spaceId: string, spaceName: string, task: string) => {
      if (store.get(runningAgentAtom)) return;
      const controller = new AbortController();
      store.set(runningAgentAtom, controller);
      store.set(agentUnavailableAtom, false);
      store.set(agentRunAtom, {
        spaceId,
        spaceName,
        task,
        startedAt: Date.now(),
        steps: [],
        stepCount: 0,
        proposals: [],
        status: "running",
      });

      const onEvent = (event: AgentEvent) => {
        if (controller.signal.aborted) return;
        updateRun((current) => applyEvent(current, event));
      };

      try {
        await runAgentTask({ spaceId, task }, onEvent, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        const code = error instanceof AgentRequestError ? error.code : null;
        if (code === "assistant_unavailable") {
          store.set(agentRunAtom, null);
          store.set(agentUnavailableAtom, true);
        } else if (code === "run_in_progress") {
          updateRun((current) => ({
            ...current,
            status: "in_progress_refused",
          }));
        } else {
          updateRun((current) => ({ ...current, status: "failed" }));
        }
      } finally {
        if (store.get(runningAgentAtom) === controller) {
          store.set(runningAgentAtom, null);
        }
      }
    },
    [store, updateRun],
  );

  const cancel = useCallback(() => {
    const controller = store.get(runningAgentAtom);
    if (!controller) return;
    store.set(runningAgentAtom, null);
    updateRun(markCancelled);
    controller.abort();
  }, [store, updateRun]);

  const newTask = useCallback(() => {
    store.get(runningAgentAtom)?.abort();
    store.set(runningAgentAtom, null);
    store.set(agentRunAtom, null);
    store.set(agentUnavailableAtom, false);
  }, [store]);

  const startFromStale = useCallback(
    (proposal: Pick<IAgentProposalSummary, "pageTitle" | "reason">) => {
      const current = store.get(agentRunAtom);
      if (!current) return Promise.resolve();
      return start(current.spaceId, current.spaceName, staleTaskOf(proposal));
    },
    [store, start],
  );

  const setProposalStatus = useCallback(
    (proposalId: string, status: AgentProposalStatus) => {
      updateRun((current) => ({
        ...current,
        proposals: current.proposals.map((proposal) =>
          proposal.id === proposalId ? { ...proposal, status } : proposal,
        ),
      }));
    },
    [updateRun],
  );

  const clearUnavailable = useCallback(() => {
    store.set(agentUnavailableAtom, false);
  }, [store]);

  return {
    run,
    unavailable,
    inProgressRefused: run?.status === "in_progress_refused",
    isRunning: run?.status === "running",
    start,
    cancel,
    newTask,
    startFromStale,
    setProposalStatus,
    clearUnavailable,
  };
}
