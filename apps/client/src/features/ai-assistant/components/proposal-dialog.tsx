import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { ProposalStatusBadge } from "@/features/ai-assistant/components/proposal-card.tsx";
import WordDiff from "@/features/ai-assistant/components/word-diff.tsx";
import {
  AgentProposalError,
  applyAgentProposal,
  discardAgentProposal,
  getAgentProposal,
} from "@/features/ai-assistant/services/ai-assistant-service.ts";
import type {
  AgentProposalStatus,
  IAgentProposalView,
  IAgentRunProposal,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

interface ProposalDialogProps {
  opened: boolean;
  proposal: IAgentRunProposal;
  onClose: () => void;
  onStatus: (status: AgentProposalStatus) => void;
  onNewProposal: () => void;
}

type DialogState =
  | { kind: "loading" }
  | { kind: "ready"; view: IAgentProposalView; writeFailed: boolean }
  | { kind: "gone" }
  | { kind: "unreachable" };

function failureState(error: unknown): DialogState {
  if (error instanceof AgentProposalError && error.code === "page_gone") {
    return { kind: "gone" };
  }
  return { kind: "unreachable" };
}

function ProposalContent(props: Omit<ProposalDialogProps, "opened">) {
  const { proposal, onClose, onStatus, onNewProposal } = props;
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<DialogState>({ kind: "loading" });
  const { t } = useTranslation();

  const load = useCallback(async () => {
    try {
      const view = await getAgentProposal(proposal.id);
      if (view.status !== proposal.status) onStatus(view.status);
      setState({ kind: "ready", view, writeFailed: false });
    } catch (error) {
      setState(failureState(error));
    }
  }, [proposal.id, proposal.status, onStatus]);

  useEffect(() => {
    void load();
  }, []);

  const finish = (status: AgentProposalStatus) => {
    onStatus(status);
    onClose();
  };

  const handleFailure = async (error: unknown, view: IAgentProposalView) => {
    const code = error instanceof AgentProposalError ? error.code : null;
    if (code === "stale") {
      onStatus("stale");
      setState({
        kind: "ready",
        view: { ...view, status: "stale" },
        writeFailed: false,
      });
    } else if (code === "write_failed") {
      setState({ kind: "ready", view, writeFailed: true });
    } else if (code === "not_editable") {
      setState({
        kind: "ready",
        view: { ...view, canEdit: false },
        writeFailed: false,
      });
    } else if (code === "not_open") {
      await load();
    } else {
      setState(failureState(error));
    }
  };

  const run = async (
    view: IAgentProposalView,
    action: () => Promise<void>,
    status: AgentProposalStatus,
  ) => {
    setBusy(true);
    try {
      await action();
      if (status === "applied") {
        notifications.show({ message: t("Change applied.") });
      }
      finish(status);
    } catch (error) {
      await handleFailure(error, view);
    } finally {
      setBusy(false);
    }
  };

  const closeButton = (
    <Button variant="default" onClick={onClose}>
      {t("Close")}
    </Button>
  );

  if (state.kind === "loading") {
    return (
      <Stack align="center" role="status">
        <Loader size="sm" />
      </Stack>
    );
  }

  if (state.kind === "gone" || state.kind === "unreachable") {
    return (
      <Stack>
        <Text size="sm">
          {state.kind === "gone"
            ? t("This page is no longer available.")
            : t(
                "The assistant is currently unreachable. The wiki keeps working normally.",
              )}
        </Text>
        <Group justify="flex-end">{closeButton}</Group>
      </Stack>
    );
  }

  const { view, writeFailed } = state;

  if (view.status === "stale") {
    return (
      <Stack>
        <Alert color="orange" variant="light">
          <Text size="sm">
            {t(
              "The page was changed after this proposal. The proposal can no longer be applied.",
            )}
          </Text>
        </Alert>
        <Group justify="flex-end">
          {closeButton}
          <Button
            onClick={() => {
              onClose();
              onNewProposal();
            }}
          >
            {t("Create new proposal")}
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {t("Reason: {{reason}}", { reason: view.reason })}
      </Text>
      <WordDiff changes={view.changes} />
      {view.status !== "open" && (
        <Group>
          <ProposalStatusBadge status={view.status} />
        </Group>
      )}
      {view.status === "open" && !view.canEdit && (
        <Text size="sm" c="dimmed">
          {t(
            "You only have read access to this page and cannot apply the proposal.",
          )}
        </Text>
      )}
      {view.status === "open" && view.canEdit && (
        <Text size="xs" c="dimmed">
          {t("Saved as your change.")}
        </Text>
      )}
      {writeFailed && (
        <Alert color="red" variant="light">
          <Text size="sm">
            {t("The change could not be applied. Try again.")}
          </Text>
        </Alert>
      )}
      <Group justify="flex-end">
        {view.status === "open" ? (
          <>
            <Button
              variant="subtle"
              disabled={busy}
              onClick={() =>
                void run(
                  view,
                  () => discardAgentProposal(proposal.id),
                  "discarded",
                )
              }
            >
              {t("Discard")}
            </Button>
            <Button
              disabled={!view.canEdit || busy}
              onClick={() =>
                void run(view, () => applyAgentProposal(proposal.id), "applied")
              }
            >
              {t("Take over")}
            </Button>
          </>
        ) : (
          closeButton
        )}
      </Group>
    </Stack>
  );
}

export default function ProposalDialog({
  opened,
  ...content
}: ProposalDialogProps) {
  const { t } = useTranslation();

  return (
    <Modal
      opened={opened}
      onClose={content.onClose}
      size="80%"
      title={t("Proposal: {{title}}", { title: content.proposal.pageTitle })}
    >
      <ProposalContent {...content} />
    </Modal>
  );
}
