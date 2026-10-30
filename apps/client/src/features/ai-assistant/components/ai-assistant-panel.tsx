import {
  Alert,
  Button,
  Loader,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import AgentTaskTab from "@/features/ai-assistant/components/agent-task-tab.tsx";
import {
  assistantTabAtom,
  type AssistantTab,
} from "@/features/ai-assistant/atoms/assistant-tab-atom.ts";
import AskAnswer from "@/features/ai-assistant/components/ask-answer.tsx";
import AskInput from "@/features/ai-assistant/components/ask-input.tsx";
import AskScopeSelect from "@/features/ai-assistant/components/ask-scope-select.tsx";
import { useAskConversation } from "@/features/ai-assistant/hooks/use-ask-conversation.ts";
import { useAiAssistantStatusQuery } from "@/features/ai-assistant/queries/ai-assistant-query.ts";

const UNAVAILABLE_KEY =
  "The assistant is currently unavailable. The wiki keeps working as usual.";

const EXAMPLE_QUESTION_KEYS = [
  "Who answers questions about travel expense reports?",
  "When is the core working time?",
];

export default function AiAssistantPanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useAtom(assistantTabAtom);
  const { data, isPending, isFetching, refetch } = useAiAssistantStatusQuery();

  if (isPending) {
    return <Loader size="sm" />;
  }

  const isAvailable = data?.status === "available";
  const retry = () => refetch({ cancelRefetch: false });

  return (
    <Tabs
      value={tab}
      onChange={(value) => setTab(value as AssistantTab)}
      keepMounted={false}
    >
      <Tabs.List grow>
        <Tabs.Tab value="ask">{t("Ask")}</Tabs.Tab>
        <Tabs.Tab value="task">{t("Task")}</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="ask" pt="md">
        <AskTab
          isAvailable={isAvailable}
          isFetching={isFetching}
          retry={retry}
        />
      </Tabs.Panel>
      <Tabs.Panel value="task" pt="md">
        {isAvailable ? (
          <AgentTaskTab />
        ) : (
          <UnavailableNotice isFetching={isFetching} retry={retry} />
        )}
      </Tabs.Panel>
    </Tabs>
  );
}

type StatusRetry = {
  isFetching: boolean;
  retry: () => Promise<unknown>;
};

function UnavailableNotice({
  isFetching,
  retry,
  onRetried,
}: StatusRetry & { onRetried?: () => void }) {
  const { t } = useTranslation();

  return (
    <Stack gap="sm">
      <Alert color="yellow" variant="light">
        <Text size="sm">{t(UNAVAILABLE_KEY)}</Text>
      </Alert>
      <Button
        variant="default"
        loading={isFetching}
        onClick={() => retry().then(onRetried)}
      >
        {t("Try again")}
      </Button>
    </Stack>
  );
}

function AskTab({
  isAvailable,
  isFetching,
  retry,
}: StatusRetry & { isAvailable: boolean }) {
  const { t } = useTranslation();
  const {
    turns,
    scope,
    setScope,
    send,
    stop,
    isPending: isAnswering,
    isUnavailable,
    clearUnavailable,
  } = useAskConversation();

  if (isAvailable && !isUnavailable) {
    return (
      <Stack gap="sm">
        <AskScopeSelect scope={scope} onChange={setScope} />
        {turns.length === 0 ? (
          <Stack gap="xs" align="center" mt="md">
            <IconSparkles size={28} />
            <Title order={3} size="h5">
              {t("Ask the wiki")}
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              {t(
                "Answers rely only on pages you are allowed to see and name their sources.",
              )}
            </Text>
            {EXAMPLE_QUESTION_KEYS.map((key) => (
              <UnstyledButton
                key={key}
                w="100%"
                p="xs"
                style={{
                  border: "1px solid var(--mantine-color-default-border)",
                  borderRadius: "var(--mantine-radius-sm)",
                }}
                onClick={() => send(t(key))}
              >
                <Text size="sm">{t(key)}</Text>
              </UnstyledButton>
            ))}
          </Stack>
        ) : (
          turns.map((turn) => (
            <Stack key={turn.id} gap="xs">
              <Paper bg="gray.1" p="xs" radius="md">
                <Text size="sm">{turn.question}</Text>
              </Paper>
              <AskAnswer turn={turn} />
            </Stack>
          ))
        )}
        <AskInput
          disabled={false}
          isPending={isAnswering}
          onSend={send}
          onStop={stop}
        />
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      <UnavailableNotice
        isFetching={isFetching}
        retry={retry}
        onRetried={clearUnavailable}
      />
      <AskInput disabled isPending={false} onSend={send} onStop={stop} />
    </Stack>
  );
}
