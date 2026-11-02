import { ActionIcon, Tooltip } from "@mantine/core";
import { IconMessagePlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { assistantTabAtom } from "@/features/ai-assistant/atoms/assistant-tab-atom.ts";
import { useAskConversation } from "@/features/ai-assistant/hooks/use-ask-conversation.ts";
import { useAiAssistantStatusQuery } from "@/features/ai-assistant/queries/ai-assistant-query.ts";

export default function NewConversationButton() {
  const { t } = useTranslation();
  const { turns, isPending, isUnavailable, newConversation } =
    useAskConversation();
  const { data } = useAiAssistantStatusQuery();
  const tab = useAtomValue(assistantTabAtom);

  if (data?.status !== "available" || isUnavailable || tab !== "ask") {
    return null;
  }

  return (
    <Tooltip label={t("New conversation")} withArrow>
      <ActionIcon
        variant="subtle"
        color="gray"
        onClick={newConversation}
        disabled={turns.length === 0 && !isPending}
        aria-label={t("New conversation")}
      >
        <IconMessagePlus size={18} />
      </ActionIcon>
    </Tooltip>
  );
}
