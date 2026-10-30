import { Injectable, Logger } from '@nestjs/common';
import { User } from '@docmost/db/types/entity.types';
import { AiBridgeError, AiBridgeErrorCode } from '../ai-bridge.errors';
import { AgentBlockRead, AgentDiffOp } from './agent-document';
import { AiAgentProposalRecords } from './ai-agent-proposal-records.service';
import { describeError } from './ai-content.service';
import { AiLiveDocumentService } from './ai-live-document.service';
import { AiPageAccessService } from './ai-page-access.service';
import {
  AiAgentProposalStatus,
  AiServiceAgentProposal,
} from './ai-service.client';

type ProposalOutcome =
  | 'applied'
  | 'discarded'
  | 'stale'
  | 'not_editable'
  | 'page_not_found'
  | 'proposal_not_open'
  | 'write_failed';

const REFUSAL_OUTCOMES: Partial<Record<AiBridgeErrorCode, ProposalOutcome>> = {
  page_not_editable: 'not_editable',
  page_not_found: 'page_not_found',
  proposal_not_open: 'proposal_not_open',
  proposal_stale: 'stale',
  write_failed: 'write_failed',
};

export interface AiAgentProposalView {
  id: string;
  runId: string;
  pageId: string;
  pageTitle: string;
  reason: string;
  status: Exclude<AiAgentProposalStatus, 'applying'>;
  canEdit: boolean;
  added: number;
  removed: number;
  changes: { heading: string | null; ops: AgentDiffOp[] }[];
}

@Injectable()
export class AiAgentProposalService {
  constructor(
    private readonly aiAgentProposalRecords: AiAgentProposalRecords,
    private readonly aiPageAccessService: AiPageAccessService,
    private readonly aiLiveDocumentService: AiLiveDocumentService,
  ) {}

  private readonly logger = new Logger(AiAgentProposalService.name);

  async viewProposal(
    user: User,
    proposalId: string,
  ): Promise<AiAgentProposalView> {
    const proposal = await this.aiAgentProposalRecords.get(user, proposalId);
    const canEdit = await this.canEdit(user, proposal.pageId);
    return {
      id: proposal.id,
      runId: proposal.runId,
      pageId: proposal.pageId,
      pageTitle: proposal.pageTitle,
      reason: proposal.reason,
      status: await this.currentStatus(user, proposal),
      canEdit,
      added: proposal.added,
      removed: proposal.removed,
      changes: proposal.changes.map(({ heading, ops }) => ({ heading, ops })),
    };
  }

  async applyProposal(
    user: User,
    proposalId: string,
  ): Promise<{ status: 'applied' }> {
    const proposal = await this.aiAgentProposalRecords.get(user, proposalId);
    return this.logOutcomeOf('apply', proposal, async () => {
      await this.aiPageAccessService.findEditablePage(user, proposal.pageId);
      await this.aiAgentProposalRecords.transition(
        user,
        proposal.id,
        'applying',
      );
      const written = await this.aiLiveDocumentService.writeChanges(
        user,
        proposal,
      );
      if (written === 'applied') {
        await this.recordTransition(user, proposal, 'applied');
        return { status: 'applied' as const };
      }
      if (written === 'stale') {
        await this.recordTransition(user, proposal, 'stale');
        throw new AiBridgeError(
          'proposal_stale',
          'The page changed after the proposal was made',
        );
      }
      await this.recordTransition(user, proposal, 'open');
      throw new AiBridgeError(
        'write_failed',
        'Writing the proposal into the page failed',
      );
    });
  }

  async discardProposal(
    user: User,
    proposalId: string,
  ): Promise<{ status: 'discarded' }> {
    const proposal = await this.aiAgentProposalRecords.get(user, proposalId);
    return this.logOutcomeOf('discard', proposal, async () => {
      await this.aiAgentProposalRecords.transition(
        user,
        proposal.id,
        'discarded',
      );
      return { status: 'discarded' as const };
    });
  }

  private async canEdit(user: User, pageId: string): Promise<boolean> {
    try {
      await this.aiPageAccessService.findEditablePage(user, pageId);
      return true;
    } catch (error) {
      if (isRefusal(error, 'page_not_editable')) return false;
      throw error;
    }
  }

  private async currentStatus(
    user: User,
    proposal: AiServiceAgentProposal,
  ): Promise<AiAgentProposalView['status']> {
    if (proposal.status !== 'open' && proposal.status !== 'applying') {
      return proposal.status;
    }
    const live = await this.aiLiveDocumentService.readBlocks(proposal.pageId);
    if (!changedSinceRead(proposal, live)) return 'open';
    const marked = await this.aiAgentProposalRecords
      .transition(user, proposal.id, 'stale')
      .catch((error: unknown) => {
        if (!isRefusal(error, 'proposal_not_open')) throw error;
        return this.aiAgentProposalRecords.get(user, proposal.id);
      });
    return marked.status === 'applying' ? 'open' : marked.status;
  }

  private async recordTransition(
    user: User,
    proposal: AiServiceAgentProposal,
    to: AiAgentProposalStatus,
  ): Promise<void> {
    try {
      await this.aiAgentProposalRecords.transition(user, proposal.id, to);
    } catch (error) {
      this.logger.warn(
        `Keeping the page answer, recording proposal ${proposal.id} as ${to} failed: ${describeError(error)}`,
      );
    }
  }

  private async logOutcomeOf<T extends { status: 'applied' | 'discarded' }>(
    action: 'apply' | 'discard',
    proposal: AiServiceAgentProposal,
    work: () => Promise<T>,
  ): Promise<T> {
    const log = (outcome: ProposalOutcome) =>
      this.logger.log(
        `agent ${action} run=${proposal.runId} proposal=${proposal.id} outcome=${outcome}`,
      );
    try {
      const result = await work();
      log(result.status);
      return result;
    } catch (error) {
      const outcome =
        error instanceof AiBridgeError
          ? REFUSAL_OUTCOMES[error.code]
          : undefined;
      if (outcome) log(outcome);
      throw error;
    }
  }
}

function changedSinceRead(
  proposal: AiServiceAgentProposal,
  live: AgentBlockRead,
): boolean {
  if (live.fingerprint !== proposal.fingerprint) return true;
  return proposal.changes.some(
    (change) =>
      live.blocks.find((block) => block.number === change.block)?.text !==
      change.oldText,
  );
}

function isRefusal(error: unknown, code: AiBridgeErrorCode): boolean {
  return error instanceof AiBridgeError && error.code === code;
}
