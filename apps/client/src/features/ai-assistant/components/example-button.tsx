import { Text, UnstyledButton } from "@mantine/core";

interface ExampleButtonProps {
  text: string;
  onClick: () => void;
}

export default function ExampleButton({ text, onClick }: ExampleButtonProps) {
  return (
    <UnstyledButton
      w="100%"
      p="xs"
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: "var(--mantine-radius-sm)",
      }}
      onClick={onClick}
    >
      <Text size="sm">{text}</Text>
    </UnstyledButton>
  );
}
