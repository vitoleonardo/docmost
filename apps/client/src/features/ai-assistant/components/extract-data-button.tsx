import { ActionIcon, ActionIconProps, Tooltip } from "@mantine/core";
import { IconListDetails } from "@tabler/icons-react";
import { Editor, useEditorState } from "@tiptap/react";
import { useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { extractionRequestAtom } from "@/features/ai-assistant/atoms/extraction-atom.ts";
import { useAiAssistantStatusQuery } from "@/features/ai-assistant/queries/ai-assistant-query.ts";

interface ExtractDataButtonProps extends Pick<
  ActionIconProps,
  "size" | "variant" | "color"
> {
  editor: Editor;
  attachmentId: string | null | undefined;
  fileName: string | null | undefined;
  iconSize?: number;
}

export default function ExtractDataButton({
  editor,
  attachmentId,
  fileName,
  iconSize = 18,
  variant = "default",
  ...actionIconProps
}: ExtractDataButtonProps) {
  const { t } = useTranslation();
  const status = useAiAssistantStatusQuery();
  const setRequest = useSetAtom(extractionRequestAtom);
  const editable = useEditorState({
    editor,
    selector: (ctx) => ctx.editor.isEditable,
  });
  const pageId: string | undefined = Reflect.get(editor.storage, "pageId");

  if (
    status.data?.status !== "available" ||
    !editable ||
    !pageId ||
    !attachmentId
  ) {
    return null;
  }

  return (
    <Tooltip label={t("Extract data")} position="top" withinPortal={false}>
      <ActionIcon
        {...actionIconProps}
        variant={variant}
        aria-label={t("Extract data")}
        onClick={() =>
          setRequest({ editor, pageId, attachmentId, fileName: fileName ?? "" })
        }
      >
        <IconListDetails size={iconSize} />
      </ActionIcon>
    </Tooltip>
  );
}
