import { Fragment } from "react";
import { Stack, Text } from "@mantine/core";
import type { IAgentProposalView } from "@/features/ai-assistant/types/ai-assistant.types.ts";

type Change = IAgentProposalView["changes"][number];

const REMOVED_STYLE = {
  textDecoration: "line-through",
  color: "var(--mantine-color-red-8)",
  backgroundColor: "var(--mantine-color-red-0)",
};

const ADDED_STYLE = {
  textDecoration: "none",
  color: "var(--mantine-color-green-9)",
  backgroundColor: "var(--mantine-color-green-1)",
};

function ChangeDiff({ change }: { change: Change }) {
  return (
    <Stack gap={4}>
      {change.heading !== null && (
        <Text fw={600} size="sm">
          {change.heading}
        </Text>
      )}
      <Text size="sm">
        {change.ops.map((op, index) => (
          <Fragment key={index}>
            {index > 0 && " "}
            {op.op === "remove" && <del style={REMOVED_STYLE}>{op.text}</del>}
            {op.op === "add" && <ins style={ADDED_STYLE}>{op.text}</ins>}
            {op.op === "keep" && <span>{op.text}</span>}
          </Fragment>
        ))}
      </Text>
    </Stack>
  );
}

export default function WordDiff({ changes }: { changes: Change[] }) {
  return (
    <Stack gap="sm">
      {changes.map((change, index) => (
        <ChangeDiff key={index} change={change} />
      ))}
    </Stack>
  );
}
