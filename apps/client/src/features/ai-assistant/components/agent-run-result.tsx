import { useState } from "react";
import { Alert, Button, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import AnswerMarkdown from "@/features/ai-assistant/components/answer-markdown.tsx";
import ProposalCard from "@/features/ai-assistant/components/proposal-card.tsx";
import ProposalDialog from "@/features/ai-assistant/components/proposal-dialog.tsx";
import { useAgentRun } from "@/features/ai-assistant/hooks/use-agent-run.ts";
import type { IAgentRun } from "@/features/ai-assistant/types/ai-assistant.types.ts";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const LIMIT_HINTS: Record<string, string> = {
  step_limit: "Stopped after 20 steps. Not all pages were checked.",
  time_limit: "Stopped after 10 minutes. Not all pages were checked.",
  token_limit: "Stopped after 200,000 tokens. Not all pages were checked.",
  context_too_small:
    "The history no longer fits into the language model. Not all pages were checked.",
};

function pagesRead(run: IAgentRun): number {
  const titles = run.steps.flatMap((step) =>
    step.kind === "read" ? [step.title] : [],
  );
  const readInSteps = new Set(titles).size;
  if (!run.end) return readInSteps;
  return run.end.outcome === "model_failed"
    ? Math.max(run.end.pagesRead, readInSteps)
    : run.end.pagesRead;
}

function summaryText(t: Translate, run: IAgentRun): string {
  const proposalCount = run.proposals.length;
  const pageCount = pagesRead(run);
  const proposals =
    proposalCount === 0
      ? t("No proposals")
      : proposalCount === 1
        ? t("1 proposal")
        : t("{{count}} proposals", { count: proposalCount });
  const pages =
    pageCount === 1
      ? t("1 page read")
      : t("{{count}} pages read", { count: pageCount });
  return t("{{proposals}} · {{pages}}", { proposals, pages });
}

function endNotice(t: Translate, run: IAgentRun) {
  if (run.status === "cancelled") {
    return <Text size="sm">{t("Cancelled. Earlier proposals are kept.")}</Text>;
  }
  const outcome = run.end?.outcome ?? "model_failed";
  if (outcome === "finished") {
    return run.end?.message ? (
      <AnswerMarkdown text={run.end.message} sources={[]} />
    ) : null;
  }
  if (outcome === "model_failed") {
    return (
      <Text size="sm">
        {t("The language model is not responding right now. Try again later.")}
      </Text>
    );
  }
  return (
    <Alert color="orange" variant="light">
      <Text size="sm">{t(LIMIT_HINTS[outcome])}</Text>
    </Alert>
  );
}

export default function AgentRunResult({ run }: { run: IAgentRun }) {
  const { t } = useTranslation();
  const { newTask, startFromStale, setProposalStatus } = useAgentRun();
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = run.proposals.find((proposal) => proposal.id === viewingId);
  const outOfScope = run.end?.outcome === "out_of_scope";

  return (
    <Stack gap="sm">
      {outOfScope ? (
        <Text size="sm">
          {t(
            "I cannot do that with my tools. I can search pages in a space, read pages and suggest changes to pages that you review and apply.",
          )}
        </Text>
      ) : (
        <>
          <Text size="sm" fw={600}>
            {summaryText(t, run)}
          </Text>
          {run.proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              onView={() => setViewingId(proposal.id)}
            />
          ))}
          {endNotice(t, run)}
        </>
      )}
      <Button variant="default" onClick={newTask}>
        {t("New task")}
      </Button>
      {viewing && (
        <ProposalDialog
          opened
          proposal={viewing}
          onClose={() => setViewingId(null)}
          onStatus={(status) => setProposalStatus(viewing.id, status)}
          onNewProposal={() => void startFromStale(viewing)}
        />
      )}
    </Stack>
  );
}
