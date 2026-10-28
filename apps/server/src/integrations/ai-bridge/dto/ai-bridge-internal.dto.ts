import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const MAX_FILTER_PAGE_IDS = 500;
const MAX_SEARCH_QUERY_LENGTH = 200;

const lowercaseString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;
const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
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

export class PageIdDto {
  @IsUUID()
  @Transform(lowercaseString)
  pageId: string;
}

export class AttachmentIdDto {
  @IsUUID()
  @Transform(lowercaseString)
  attachmentId: string;
}

export class SearchToolDto {
  @IsUUID()
  @Transform(lowercaseString)
  spaceId: string;

  @IsString()
  @MaxLength(MAX_SEARCH_QUERY_LENGTH)
  @Transform(trimString)
  query: string;
}

export class PageListDto {
  @IsOptional()
  @IsUUID()
  @Transform(lowercaseString)
  cursor?: string;
}
