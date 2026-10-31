import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  Textarea,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import {
  extractContract,
  ExtractRequestError,
} from "@/features/ai-assistant/services/ai-assistant-service.ts";
import {
  CONTRACT_FIELD_KEYS,
  CONTRACT_FIELD_LABELS,
} from "@/features/ai-assistant/services/contract-table.ts";
import type {
  ExtractedFieldKey,
  ExtractRequestErrorCode,
  ExtractResult,
  IExtractedField,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

export type ContractValues = Record<ExtractedFieldKey, string>;

interface ExtractionDialogProps {
  opened: boolean;
  fileName: string;
  pageId: string;
  attachmentId: string;
  editable: boolean;
  onInsert: (values: ContractValues, fields: IExtractedField[]) => void;
  onClose: () => void;
}

type Refused = Extract<ExtractResult, { outcome: "refused" }>;

type DialogState =
  | { kind: "loading" }
  | { kind: "review"; fields: IExtractedField[]; seconds: number }
  | { kind: "refused"; result: Refused }
  | { kind: "error"; code: ExtractRequestErrorCode };

const BYTES_PER_MB = 1_048_576;

function formatMegabytesRoundedUp(bytes: number): string {
  const tenths = Math.floor((bytes * 10 + BYTES_PER_MB - 1) / BYTES_PER_MB);
  return `${Math.floor(tenths / 10)},${tenths % 10}`;
}

function formatWithDots(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function hasSource(field: IExtractedField): boolean {
  return field.value !== null && field.quote !== null;
}

function initialValues(fields: IExtractedField[]): ContractValues {
  const values = {} as ContractValues;
  for (const key of CONTRACT_FIELD_KEYS) {
    values[key] = fields.find((field) => field.key === key)?.value ?? "";
  }
  return values;
}

function ExtractionContent({
  fileName,
  pageId,
  attachmentId,
  editable,
  onInsert,
  onClose,
}: Omit<ExtractionDialogProps, "opened">) {
  const { t } = useTranslation();
  const [state, setState] = useState<DialogState>({ kind: "loading" });
  const [values, setValues] = useState<ContractValues>(() => initialValues([]));
  const controllerRef = useRef<AbortController | null>(null);
  const insertedRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const startedAt = Date.now();

    extractContract(pageId, attachmentId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.outcome === "extracted") {
          setValues(initialValues(result.fields));
          setState({
            kind: "review",
            fields: result.fields,
            seconds: Math.ceil((Date.now() - startedAt) / 1000),
          });
        } else if (result.outcome === "refused") {
          setState({ kind: "refused", result });
        } else {
          setState({ kind: "error", code: "model" });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const code =
          error instanceof ExtractRequestError ? error.code : "model";
        setState({ kind: "error", code });
      });

    return () => controller.abort();
  }, [pageId, attachmentId]);

  const cancel = () => {
    controllerRef.current?.abort();
    onClose();
  };

  const insert = () => {
    if (state.kind !== "review" || insertedRef.current) return;
    insertedRef.current = true;
    onInsert(values, state.fields);
  };

  const refusalText = (result: Refused): string => {
    switch (result.reason) {
      case "no_text_layer":
        return t(
          "This PDF contains no text (probably scanned). Text recognition is not part of this version.",
        );
      case "too_many_pages":
        return t(
          "The file has {{count}} pages. Files up to 10 pages, 10 MB and 30,000 characters of text are extracted.",
          { count: result.pageCount },
        );
      case "too_large":
        return t(
          "The file is {{size}} MB. Files up to 10 pages, 10 MB and 30,000 characters of text are extracted.",
          { size: formatMegabytesRoundedUp(result.fileSize ?? 0) },
        );
      case "too_much_text":
        return t(
          "The file contains {{count}} characters of text. Files up to 10 pages, 10 MB and 30,000 characters of text are extracted.",
          { count: formatWithDots(result.characterCount ?? 0) },
        );
      case "unreadable":
        return t("This PDF cannot be read.");
    }
  };

  const errorText = (code: ExtractRequestErrorCode): string => {
    switch (code) {
      case "model":
        return t(
          "The language model is not answering right now. Try again later.",
        );
      case "unreachable":
        return t(
          "The assistant is currently unavailable. The wiki keeps working as usual.",
        );
      case "not_available":
        return t(
          "The attachment is no longer available or you may not edit the page.",
        );
    }
  };

  const closeWithMessage = (message: string) => (
    <Stack>
      <Text>{message}</Text>
      <Group justify="flex-end">
        <Button onClick={onClose}>{t("Close")}</Button>
      </Group>
    </Stack>
  );

  const review = (current: Extract<DialogState, { kind: "review" }>) => {
    const withoutSource = current.fields.filter(
      (field) => !hasSource(field),
    ).length;
    return (
      <Stack>
        <Group justify="space-between">
          <Text fw={500}>{t("Schema: Contract")}</Text>
          <Text size="sm" c="dimmed">
            {t("Done in {{seconds}} s", { seconds: current.seconds })}
          </Text>
        </Group>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("Field")}</Table.Th>
              <Table.Th w="45%">{t("Value")}</Table.Th>
              <Table.Th>{t("Source")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {CONTRACT_FIELD_KEYS.map((key) => {
              const field = current.fields.find(
                (candidate) => candidate.key === key,
              );
              const sourced = field !== undefined && hasSource(field);
              return (
                <Table.Tr key={key}>
                  <Table.Td>{CONTRACT_FIELD_LABELS[key]}</Table.Td>
                  <Table.Td>
                    <Textarea
                      autosize
                      minRows={1}
                      miw={140}
                      styles={
                        sourced
                          ? undefined
                          : {
                              input: {
                                borderColor: "var(--mantine-color-orange-6)",
                                backgroundColor:
                                  "var(--mantine-color-orange-0)",
                              },
                            }
                      }
                      aria-label={CONTRACT_FIELD_LABELS[key]}
                      placeholder={t("Enter value manually")}
                      value={values[key]}
                      onChange={(event) => {
                        const { value } = event.currentTarget;
                        setValues((previous) => ({
                          ...previous,
                          [key]: value,
                        }));
                      }}
                    />
                    {!sourced && (
                      <Badge color="orange" tt="none" mt={4}>
                        {t("Not found")}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {sourced ? (
                      <Text size="sm">
                        {`„${field.quote}“ · ${t("Page {{page}}", { page: field.pdfPage })}`}
                      </Text>
                    ) : (
                      <Text size="sm" c="dimmed">
                        {t("No source in the document.")}
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        {withoutSource > 0 && (
          <Text size="sm">
            {withoutSource === 1
              ? t("1 field without source")
              : t("{{count}} fields without source", { count: withoutSource })}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={cancel}>
            {t("Cancel")}
          </Button>
          <Button disabled={!editable} onClick={insert}>
            {t("Insert as table")}
          </Button>
        </Group>
      </Stack>
    );
  };

  const body = () => {
    switch (state.kind) {
      case "loading":
        return (
          <Stack align="center">
            <Loader size="sm" />
            <Text>{t("Reading {{fileName}} …", { fileName })}</Text>
            <Button variant="default" onClick={cancel}>
              {t("Cancel")}
            </Button>
          </Stack>
        );
      case "review":
        return review(state);
      case "refused":
        return closeWithMessage(refusalText(state.result));
      case "error":
        return closeWithMessage(errorText(state.code));
    }
  };

  return body();
}

export default function ExtractionDialog({
  opened,
  fileName,
  onClose,
  ...content
}: ExtractionDialogProps) {
  const { t } = useTranslation();
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="80%"
      title={t("Extract data: {{fileName}}", { fileName })}
    >
      <ExtractionContent fileName={fileName} onClose={onClose} {...content} />
    </Modal>
  );
}
