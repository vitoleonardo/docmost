import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import AgentSpaceSelect from "@/features/ai-assistant/components/agent-space-select.tsx";
import ExampleButton from "@/features/ai-assistant/components/example-button.tsx";
import AskInput from "@/features/ai-assistant/components/ask-input.tsx";
import { useAgentRun } from "@/features/ai-assistant/hooks/use-agent-run.ts";
import type {
  AgentStepLabel,
  IAgentRun,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";
import { usePageQuery } from "@/features/page/queries/page-query.ts";
import { useGetSpacesQuery } from "@/features/space/queries/space-query.ts";
import { extractPageSlugId } from "@/lib/utils.tsx";

const EXAMPLE_TASK_KEYS = [
  "Find outdated pages about travel expenses and suggest updates",
  "Check whether pages about vacation requests contradict each other",
];

function elapsedParts(milliseconds: number): {
  minutes: number;
  seconds: string;
} {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: String(totalSeconds % 60).padStart(2, "0"),
  };
}

function useElapsed(run: IAgentRun, isRunning: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isRunning]);

  return now - run.startedAt;
}

function stepText(
  t: (key: string, options?: Record<string, unknown>) => string,
  label: AgentStepLabel,
): string {
  if (label.kind === "search") {
    if (label.count === 0) {
      return t("Searched: „{{query}}“: no pages", { query: label.query });
    }
    if (label.count === 1) {
      return t("Searched: „{{query}}“: 1 page", { query: label.query });
    }
    return t("Searched: „{{query}}“: {{count}} pages", {
      query: label.query,
      count: label.count,
    });
  }
  if (label.kind === "read") {
    return t("Read: „{{title}}“", { title: label.title });
  }
  if (label.kind === "propose") {
    return t("Proposal created: „{{title}}“", { title: label.title });
  }
  return t("Step without result");
}

function RunView({
  run,
  isRunning,
  onCancel,
}: {
  run: IAgentRun;
  isRunning: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const elapsed = useElapsed(run, isRunning);

  return (
    <Stack gap="sm">
      <Text size="sm" fw={500}>
        {t("{{task}} · {{space}}", { task: run.task, space: run.spaceName })}
      </Text>
      <Stack gap={4}>
        {run.steps.map((label, index) => (
          <Text key={index} size="sm">
            {stepText(t, label)}
          </Text>
        ))}
      </Stack>
      {isRunning && (
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {t("Step {{count}} of at most 20", { count: run.stepCount })}
            </Text>
            <Text size="xs" c="dimmed">
              {t("{{minutes}}:{{seconds}} min", elapsedParts(elapsed))}
            </Text>
          </Group>
          <Button variant="default" onClick={onCancel}>
            {t("Cancel")}
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

function StartView({
  inProgressRefused,
  onStart,
}: {
  inProgressRefused: boolean;
  onStart: (spaceId: string, spaceName: string, task: string) => void;
}) {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
  const { data: page } = usePageQuery({ pageId: extractPageSlugId(pageSlug) });
  const { data } = useGetSpacesQuery({ limit: 100 });
  const [chosenSpaceId, setChosenSpaceId] = useState<string | null>(null);
  const [task, setTask] = useState("");

  const spaces = [...(data?.items ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const spaceId =
    spaces.find((space) => space.id === chosenSpaceId)?.id ??
    spaces.find((space) => space.id === page?.spaceId)?.id ??
    spaces[0]?.id ??
    null;
  const space = spaces.find((candidate) => candidate.id === spaceId);

  return (
    <Stack gap="sm">
      <AgentSpaceSelect
        spaces={spaces}
        value={spaceId}
        onChange={setChosenSpaceId}
      />
      <Alert color="blue" variant="light">
        <Text size="sm">
          {t(
            "The assistant can search pages, read them and suggest changes. Nothing is changed without your confirmation.",
          )}
        </Text>
      </Alert>
      {inProgressRefused && (
        <Alert color="yellow" variant="light">
          <Text size="sm">
            {t(
              "A task is already running. Wait until it finishes or cancel it.",
            )}
          </Text>
        </Alert>
      )}
      <Text size="xs" fw={600} c="dimmed">
        {t("Examples")}
      </Text>
      {EXAMPLE_TASK_KEYS.map((key) => (
        <ExampleButton
          key={key}
          text={t(key)}
          onClick={() => setTask(t(key))}
        />
      ))}
      <AskInput
        disabled={!space}
        isPending={false}
        placeholder={t("Describe the task …")}
        submitLabel={t("Start")}
        value={task}
        onValueChange={setTask}
        onSend={(trimmed) => space && onStart(space.id, space.name, trimmed)}
      />
    </Stack>
  );
}

export default function AgentTaskTab() {
  const { run, inProgressRefused, isRunning, start, cancel } = useAgentRun();

  if (!run || inProgressRefused) {
    return <StartView inProgressRefused={inProgressRefused} onStart={start} />;
  }

  return <RunView run={run} isRunning={isRunning} onCancel={cancel} />;
}
