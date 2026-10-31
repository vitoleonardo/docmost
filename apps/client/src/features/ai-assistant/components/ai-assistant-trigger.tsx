import { ActionIcon, Tooltip } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useAsideTriggerProps } from "@/hooks/use-toggle-aside.tsx";
import { useAiAssistantStatusQuery } from "@/features/ai-assistant/queries/ai-assistant-query.ts";

export default function AiAssistantTrigger() {
  const { t } = useTranslation();
  const { data, isPending } = useAiAssistantStatusQuery();
  const triggerProps = useAsideTriggerProps("ai-assistant");

  if (isPending || data?.status === "disabled") {
    return null;
  }

  return (
    <Tooltip label={t("Assistant")} openDelay={250} withArrow>
      <ActionIcon
        variant="subtle"
        color="dark"
        aria-label={t("Assistant")}
        {...triggerProps}
      >
        <IconSparkles size={20} stroke={2} />
      </ActionIcon>
    </Tooltip>
  );
}
