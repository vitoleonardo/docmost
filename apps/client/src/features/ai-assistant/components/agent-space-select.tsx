import { Select } from "@mantine/core";
import { useTranslation } from "react-i18next";

const NO_SPACE = "no-space";

export interface AgentSpaceOption {
  id: string;
  name: string;
}

interface AgentSpaceSelectProps {
  spaces: AgentSpaceOption[];
  value: string | null;
  onChange: (spaceId: string) => void;
}

export default function AgentSpaceSelect({
  spaces,
  value,
  onChange,
}: AgentSpaceSelectProps) {
  const { t } = useTranslation();
  const hasSpaces = spaces.length > 0;
  const data = hasSpaces
    ? spaces.map((space) => ({ value: space.id, label: space.name }))
    : [{ value: NO_SPACE, label: t("No space") }];

  return (
    <Select
      label={t("Space")}
      size="xs"
      allowDeselect={false}
      disabled={!hasSpaces}
      data={data}
      value={hasSpaces ? value : NO_SPACE}
      onChange={(next) => next && onChange(next)}
    />
  );
}
