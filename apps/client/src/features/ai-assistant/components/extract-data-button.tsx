import { useState } from "react";
import { ActionIcon, Tooltip } from "@mantine/core";
import { IconListDetails } from "@tabler/icons-react";
import { Editor, useEditorState } from "@tiptap/react";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import ExtractionDialog, {
  ContractValues,
} from "@/features/ai-assistant/components/extraction-dialog.tsx";
import { useAiAssistantStatusQuery } from "@/features/ai-assistant/queries/ai-assistant-query.ts";
import {
  buildContractTableContent,
  insertContractTable,
} from "@/features/ai-assistant/services/contract-table.ts";
import type { IExtractedField } from "@/features/ai-assistant/types/ai-assistant.types.ts";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";

interface ExtractDataButtonProps {
  editor: Editor;
  attachmentId: string | null | undefined;
  fileName: string | null | undefined;
}

export default function ExtractDataButton({
  editor,
  attachmentId,
  fileName,
}: ExtractDataButtonProps) {
  const { t } = useTranslation();
  const status = useAiAssistantStatusQuery();
  const currentUser = useAtomValue(currentUserAtom);
  const [opened, setOpened] = useState(false);
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

  const handleInsert = (values: ContractValues, fields: IExtractedField[]) => {
    insertContractTable(
      editor,
      attachmentId,
      buildContractTableContent({
        fileName: fileName ?? "",
        reviewerName: currentUser?.user.name ?? "",
        date: new Date(),
        fields,
        values,
      }),
    );
    setOpened(false);
  };

  return (
    <>
      <Tooltip label={t("Extract data")} position="top" withinPortal={false}>
        <ActionIcon
          variant="default"
          aria-label={t("Extract data")}
          onClick={() => setOpened(true)}
        >
          <IconListDetails size={18} />
        </ActionIcon>
      </Tooltip>
      {opened && (
        <ExtractionDialog
          opened
          fileName={fileName ?? ""}
          pageId={pageId}
          attachmentId={attachmentId}
          editable={editable}
          onInsert={handleInsert}
          onClose={() => setOpened(false)}
        />
      )}
    </>
  );
}
