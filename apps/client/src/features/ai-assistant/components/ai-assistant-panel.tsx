import { Alert, Button, Loader, Stack, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useAiAssistantStatusQuery } from "@/features/ai-assistant/queries/ai-assistant-query.ts";

export default function AiAssistantPanel() {
  const { t } = useTranslation();
  const { data, isPending, isFetching, refetch } = useAiAssistantStatusQuery();

  if (isPending) {
    return <Loader size="sm" />;
  }

  if (data?.status === "available") {
    return (
      <Stack gap="xs">
        <Title order={3} size="h5">
          {t("Ask the wiki")}
        </Title>
        <Text size="sm" c="dimmed">
          {t(
            "Answers rely only on pages you are allowed to see and name their sources.",
          )}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      <Alert color="yellow" variant="light">
        <Text size="sm">
          {t(
            "The assistant is currently unavailable. The wiki keeps working as usual.",
          )}
        </Text>
      </Alert>
      <Button
        variant="default"
        loading={isFetching}
        onClick={() => refetch({ cancelRefetch: false })}
      >
        {t("Try again")}
      </Button>
    </Stack>
  );
}
