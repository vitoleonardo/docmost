import {
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { IconMessagePlus, IconSparkles } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
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
  const {
    turns,
    scope,
    setScope,
    send,
    stop,
    newConversation,
    isPending: isAnswering,
    isUnavailable,
    clearUnavailable,
  } = useAskConversation();
  const { data, isPending, isFetching, refetch } = useAiAssistantStatusQuery();

  if (isPending) {
    return <Loader size="sm" />;
  }

  const unavailableNotice = (
    <Alert color="yellow" variant="light">
      <Text size="sm">{t(UNAVAILABLE_KEY)}</Text>
    </Alert>
  );

  if (data?.status === "available" && !isUnavailable) {
    return (
      <Stack gap="sm">
        {turns.length > 0 && (
          <Group justify="flex-end">
            <Button
              variant="subtle"
              size="compact-xs"
              leftSection={<IconMessagePlus size={14} />}
              onClick={newConversation}
            >
              {t("New conversation")}
            </Button>
          </Group>
        )}
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
      {unavailableNotice}
      <Button
        variant="default"
        loading={isFetching}
        onClick={() =>
          refetch({ cancelRefetch: false }).then(clearUnavailable)
        }
      >
        {t("Try again")}
      </Button>
      <AskInput disabled isPending={false} onSend={send} onStop={stop} />
    </Stack>
  );
}
