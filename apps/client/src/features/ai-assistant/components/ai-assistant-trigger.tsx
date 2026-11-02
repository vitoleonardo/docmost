import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useSetAtom } from "jotai";
import { assistantTabAtom } from "@/features/ai-assistant/atoms/assistant-tab-atom.ts";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useAskConversation } from "@/features/ai-assistant/hooks/use-ask-conversation.ts";
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

export function AskAboutPageMenuItem({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const { data, isPending } = useAiAssistantStatusQuery();
  const { setScope } = useAskConversation();
  const setAsideState = useSetAtom(asideStateAtom);
  const setTab = useSetAtom(assistantTabAtom);

  if (isPending || data?.status === "disabled") {
    return null;
  }

  const handleClick = () => {
    setScope({ kind: "page", pageId });
    setTab("ask");
    setAsideState({ tab: "ai-assistant", isAsideOpen: true });
  };

  return (
    <Menu.Item leftSection={<IconSparkles size={16} />} onClick={handleClick}>
      {t("Ask about this page")}
    </Menu.Item>
  );
}
