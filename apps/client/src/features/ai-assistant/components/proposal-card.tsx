import { Badge, Button, Group, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type {
  AgentProposalStatus,
  IAgentRunProposal,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

const STATUS_BADGE: Record<
  Exclude<AgentProposalStatus, "open">,
  { label: string; color: string }
> = {
  applied: { label: "Taken over", color: "green" },
  discarded: { label: "Discarded", color: "gray" },
  stale: { label: "Outdated", color: "orange" },
};

export function ProposalStatusBadge({
  status,
}: {
  status: Exclude<AgentProposalStatus, "open">;
}) {
  const { t } = useTranslation();
  const { label, color } = STATUS_BADGE[status];
  return (
    <Badge color={color} variant="light">
      {t(label)}
    </Badge>
  );
}

export default function ProposalCard({
  proposal,
  onView,
}: {
  proposal: IAgentRunProposal;
  onView: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Stack
      gap={4}
      p="xs"
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: "var(--mantine-radius-sm)",
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={600}>
          {proposal.pageTitle}
        </Text>
        <Text size="xs">{`+${proposal.added} −${proposal.removed}`}</Text>
      </Group>
      <Text size="xs" c="dimmed">
        {proposal.reason}
      </Text>
      <Group justify="space-between">
        <Button variant="default" size="compact-sm" onClick={onView}>
          {t("View")}
        </Button>
        {proposal.status !== "open" && (
          <ProposalStatusBadge status={proposal.status} />
        )}
      </Group>
    </Stack>
  );
}
