import { Injectable, Logger } from '@nestjs/common';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { Attachment, Page, User } from '@docmost/db/types/entity.types';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeError, assertAssistantEnabled } from '../ai-bridge.errors';
import { AiExtractDto } from '../dto/ai-extract.dto';
import { PDF_MIME_TYPE } from './ai-content.service';
import { AiPageAccessService } from './ai-page-access.service';
import {
  AiServiceClient,
  AiServiceExtractResult,
  AiServiceMalformedResponseError,
  AiServiceTimeoutError,
  AiServiceUnreachableError,
} from './ai-service.client';
import { AiTokenService } from './ai-token.service';

@Injectable()
export class AiExtractService {
  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly aiPageAccessService: AiPageAccessService,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly aiTokenService: AiTokenService,
    private readonly aiServiceClient: AiServiceClient,
  ) {}

  async extract(
    user: User,
    { pageId, attachmentId }: AiExtractDto,
    signal: AbortSignal,
  ): Promise<AiServiceExtractResult | null> {
    assertAssistantEnabled(this.environmentService.isAiBridgeConfigured());
    const page = await this.aiPageAccessService.findEditablePage(user, pageId);
    const attachment = await this.findPdfOfPage(user, page, attachmentId);
    const userToken = await this.aiTokenService.issueUserToken(user);
    return this.aiServiceClient
      .extract(
        userToken,
        {
          attachmentId: attachment.id,
          fileSize: Number(attachment.fileSize),
        },
        signal,
      )
      .catch((error: unknown) => this.fromFailure(error, signal));
  }

  private async findPdfOfPage(
    user: User,
    page: Page,
    attachmentId: string,
  ): Promise<Attachment> {
    const attachment = await this.attachmentRepo.findById(attachmentId);
    if (
      !attachment ||
      attachment.deletedAt ||
      attachment.pageId !== page.id ||
      attachment.workspaceId !== user.workspaceId ||
      attachment.mimeType !== PDF_MIME_TYPE
    ) {
      throw new AiBridgeError('attachment_not_found', 'Attachment not found');
    }
    return attachment;
  }

  private fromFailure(
    error: unknown,
    signal: AbortSignal,
  ): AiServiceExtractResult | null {
    if (signal.aborted) return null;
    if (
      error instanceof AiServiceTimeoutError ||
      error instanceof AiServiceMalformedResponseError
    ) {
      Logger.warn(`Extraction failed: ${error.message}`, AiExtractService.name);
      return { outcome: 'failed', reason: 'model_unavailable' };
    }
    if (!(error instanceof AiServiceUnreachableError)) throw error;
    Logger.warn(
      `AI service refused the extraction: ${error.message}`,
      AiExtractService.name,
    );
    throw new AiBridgeError(
      'assistant_unavailable',
      'The AI service is not available',
    );
  }
}
