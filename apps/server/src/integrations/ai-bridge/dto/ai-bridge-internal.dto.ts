import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const MAX_FILTER_PAGE_IDS = 500;
export const TOO_MANY_PAGE_IDS_MESSAGE = `pageIds must contain at most ${MAX_FILTER_PAGE_IDS} ids`;

export class FilterPagesDto {
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_PAGE_IDS, { message: TOO_MANY_PAGE_IDS_MESSAGE })
  @IsUUID('all', { each: true })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((id) => (typeof id === 'string' ? id.toLowerCase() : id))
      : value,
  )
  pageIds: string[];
}

export class TaskTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  runId: string;
}
