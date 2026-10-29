import { Anchor, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import AnswerMarkdown from "@/features/ai-assistant/components/answer-markdown.tsx";
import type {
  IAskSource,
  IAskTurn,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

const NO_SOURCE_KEY =
  "I found no matching source in the pages you can access. Rephrase the question or contact the responsible department.";
const MODEL_ERROR_KEY =
  "The language model is not answering right now. Try again later.";

interface AskAnswerProps {
  turn: IAskTurn;
}

function SourceLabel({ source }: { source: IAskSource }) {
  const { t } = useTranslation();
  const parts = [source.spaceName];
  if (source.fileName !== null) {
    parts.push(source.fileName);
    if (source.pdfPage !== null) {
      parts.push(t("Page {{page}}", { page: source.pdfPage }));
    }
  } else {
    parts.push(...source.headingPath);
  }
  return (
    <Text size="xs" c="dimmed">
      {parts.join(" › ")}
    </Text>
  );
}

function SourceList({ sources }: { sources: IAskSource[] }) {
  const { t } = useTranslation();
  const ordered = [...sources].sort((a, b) => a.number - b.number);
  return (
    <Stack gap={4}>
      <Text size="xs" fw={600}>
        {t("Sources")}
      </Text>
      <Stack component="ul" gap={4} m={0} p={0} style={{ listStyle: "none" }}>
        {ordered.map((source) => (
          <li key={source.number}>
            <Anchor component={Link} to={source.url} size="sm">
              {`${source.number}. ${source.title}`}
            </Anchor>
            <SourceLabel source={source} />
          </li>
        ))}
      </Stack>
    </Stack>
  );
}

export default function AskAnswer({ turn }: AskAnswerProps) {
  const { t } = useTranslation();

  if (turn.status === "no_source") {
    return <Text size="sm">{t(NO_SOURCE_KEY)}</Text>;
  }

  return (
    <Stack gap="xs" fz="sm">
      {turn.answer && (
        <div>
          <AnswerMarkdown text={turn.answer} sources={turn.sources} />
        </div>
      )}
      {turn.status === "stopped" && (
        <Text size="sm" c="dimmed">
          {t("Stopped")}
        </Text>
      )}
      {turn.status === "error" && <Text size="sm">{t(MODEL_ERROR_KEY)}</Text>}
      {turn.status === "done" && turn.sources.length > 0 && (
        <SourceList sources={turn.sources} />
      )}
    </Stack>
  );
}
