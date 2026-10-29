import { useState } from "react";
import { ActionIcon, Group, Textarea } from "@mantine/core";
import { IconPlayerStopFilled, IconSend } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

export const MAX_QUESTION_LENGTH = 2000;

interface AskInputProps {
  disabled: boolean;
  isPending: boolean;
  onSend: (question: string) => void;
  onStop: () => void;
}

export default function AskInput({
  disabled,
  isPending,
  onSend,
  onStop,
}: AskInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const tooLong = trimmed.length > MAX_QUESTION_LENGTH;
  const canSend = !disabled && trimmed.length > 0 && !tooLong;

  const send = () => {
    if (!canSend || isPending) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <Group align="flex-end" gap="xs" wrap="nowrap">
      <Textarea
        style={{ flex: 1 }}
        rows={2}
        disabled={disabled}
        placeholder={t("Ask a question …")}
        value={value}
        error={tooLong ? t("At most 2,000 characters") : undefined}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          send();
        }}
      />
      {isPending ? (
        <ActionIcon
          size="lg"
          variant="default"
          aria-label={t("Stop")}
          onClick={onStop}
        >
          <IconPlayerStopFilled size={16} />
        </ActionIcon>
      ) : (
        <ActionIcon
          size="lg"
          aria-label={t("Send")}
          disabled={!canSend}
          onClick={send}
        >
          <IconSend size={16} />
        </ActionIcon>
      )}
    </Group>
  );
}
