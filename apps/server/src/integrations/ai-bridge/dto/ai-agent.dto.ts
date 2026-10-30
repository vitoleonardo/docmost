import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length } from 'class-validator';
import { lowercaseString, trimString } from './ai-bridge-internal.dto';

const MAX_TASK_LENGTH = 2000;

export class AiAgentRunDto {
  @IsUUID()
  @Transform(lowercaseString)
  spaceId: string;

  @IsString()
  @Length(1, MAX_TASK_LENGTH)
  @Transform(trimString)
  task: string;
}
