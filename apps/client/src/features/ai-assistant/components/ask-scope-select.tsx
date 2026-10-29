import { useEffect, useMemo } from "react";
import { Select } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useGetSpacesQuery } from "@/features/space/queries/space-query.ts";
import { usePageQuery } from "@/features/page/queries/page-query.ts";
import { extractPageSlugId } from "@/lib/utils.tsx";
import type { AskScope } from "@/features/ai-assistant/types/ai-assistant.types.ts";

const ALL = "all";
const PAGE = "page";
const SPACE_PREFIX = "space:";

interface AskScopeSelectProps {
  scope: AskScope;
  onChange: (scope: AskScope) => void;
}

function valueOf(scope: AskScope): string {
  if (scope.kind === "space") return `${SPACE_PREFIX}${scope.spaceId}`;
  return scope.kind === "page" ? PAGE : ALL;
}

export default function AskScopeSelect({
  scope,
  onChange,
}: AskScopeSelectProps) {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
  const { data: page } = usePageQuery({ pageId: extractPageSlugId(pageSlug) });
  const { data: spaces } = useGetSpacesQuery({ limit: 100 });
  const currentPageId = page?.id;

  useEffect(() => {
    if (
      scope.kind === "page" &&
      currentPageId &&
      scope.pageId !== currentPageId
    ) {
      onChange({ kind: "page", pageId: currentPageId });
    }
  }, [scope, currentPageId, onChange]);

  const options = useMemo(() => {
    const spaceOptions = [...(spaces?.items ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((space) => ({
        value: `${SPACE_PREFIX}${space.id}`,
        label: space.name,
      }));
    return [
      { value: ALL, label: t("All spaces") },
      ...(currentPageId ? [{ value: PAGE, label: t("This page") }] : []),
      ...spaceOptions,
    ];
  }, [spaces, currentPageId, t]);

  const handleChange = (value: string | null) => {
    if (value === PAGE && currentPageId) {
      onChange({ kind: "page", pageId: currentPageId });
    } else if (value?.startsWith(SPACE_PREFIX)) {
      onChange({ kind: "space", spaceId: value.slice(SPACE_PREFIX.length) });
    } else {
      onChange({ kind: "all" });
    }
  };

  return (
    <Select
      aria-label={t("Scope")}
      size="xs"
      allowDeselect={false}
      data={options}
      value={valueOf(scope)}
      onChange={handleChange}
    />
  );
}
