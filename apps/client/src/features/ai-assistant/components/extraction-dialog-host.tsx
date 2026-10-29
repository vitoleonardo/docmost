import { useEffect } from "react";
import { useEditorState } from "@tiptap/react";
import { useAtom, useAtomValue } from "jotai";
import ExtractionDialog, {
  ContractValues,
} from "@/features/ai-assistant/components/extraction-dialog.tsx";
import { extractionRequestAtom } from "@/features/ai-assistant/atoms/extraction-atom.ts";
import {
  buildContractTableContent,
  insertContractTable,
} from "@/features/ai-assistant/services/contract-table.ts";
import type {
  IExtractedField,
  IExtractionRequest,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";

interface OpenExtractionProps {
  request: IExtractionRequest;
  onClose: () => void;
}

function OpenExtraction({ request, onClose }: OpenExtractionProps) {
  const { editor, pageId, attachmentId, fileName } = request;
  const currentUser = useAtomValue(currentUserAtom);
  const editable = useEditorState({
    editor,
    selector: (ctx) => ctx.editor.isEditable,
  });

  const handleInsert = (values: ContractValues, fields: IExtractedField[]) => {
    insertContractTable(
      editor,
      attachmentId,
      buildContractTableContent({
        fileName,
        reviewerName: currentUser?.user.name ?? "",
        date: new Date(),
        fields,
        values,
      }),
    );
    onClose();
  };

  return (
    <ExtractionDialog
      opened
      fileName={fileName}
      pageId={pageId}
      attachmentId={attachmentId}
      editable={editable}
      onInsert={handleInsert}
      onClose={onClose}
    />
  );
}

export default function ExtractionDialogHost() {
  const [request, setRequest] = useAtom(extractionRequestAtom);

  useEffect(() => () => setRequest(null), [setRequest]);

  if (!request) return null;

  return <OpenExtraction request={request} onClose={() => setRequest(null)} />;
}
