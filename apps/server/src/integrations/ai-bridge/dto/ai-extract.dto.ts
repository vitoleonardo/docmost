import { Transform } from 'class-transformer';
import { IsUUID } from 'class-validator';
import { lowercaseString } from './ai-bridge-internal.dto';

export class AiExtractDto {
  @IsUUID()
  @Transform(lowercaseString)
  pageId: string;

  @IsUUID()
  @Transform(lowercaseString)
  attachmentId: string;
}
