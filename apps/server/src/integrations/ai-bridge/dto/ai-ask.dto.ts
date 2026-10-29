import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateBy,
  ValidationArguments,
} from 'class-validator';
import { lowercaseString, trimString } from './ai-bridge-internal.dto';

const MAX_QUESTION_LENGTH = 2000;

function IsAbsentWith(otherProperty: string): PropertyDecorator {
  return ValidateBy({
    name: 'isAbsentWith',
    constraints: [otherProperty],
    validator: {
      validate: (_value: unknown, args: ValidationArguments) =>
        (args.object as Record<string, unknown>)[otherProperty] == null,
      defaultMessage: (args: ValidationArguments) =>
        `${args.property} must not be sent together with ${otherProperty}`,
    },
  });
}

export class AiAskDto {
  @IsString()
  @Length(1, MAX_QUESTION_LENGTH)
  @Transform(trimString)
  question: string;

  @IsUUID()
  @Transform(lowercaseString)
  conversationId: string;

  @IsOptional()
  @IsUUID()
  @Transform(lowercaseString)
  spaceId?: string;

  @IsOptional()
  @IsUUID()
  @IsAbsentWith('spaceId')
  @Transform(lowercaseString)
  pageId?: string;
}
