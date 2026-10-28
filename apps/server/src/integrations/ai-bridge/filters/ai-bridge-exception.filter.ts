import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { AiBridgeError } from '../ai-bridge.errors';
import { TOO_MANY_PAGE_IDS_MESSAGE } from '../dto/ai-bridge-internal.dto';

@Catch(AiBridgeError, BadRequestException)
export class AiBridgeExceptionFilter implements ExceptionFilter {
  catch(exception: AiBridgeError | BadRequestException, host: ArgumentsHost) {
    const error =
      exception instanceof AiBridgeError
        ? exception
        : fromValidationError(exception);
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(error.status)
      .send({ code: error.code, message: error.message });
  }
}

function fromValidationError(exception: BadRequestException): AiBridgeError {
  const response = exception.getResponse();
  const raw =
    typeof response === 'object' && 'message' in response
      ? response.message
      : exception.message;
  const messages = (Array.isArray(raw) ? raw : [raw]).map(String);
  const code = messages.includes(TOO_MANY_PAGE_IDS_MESSAGE)
    ? 'too_many_page_ids'
    : 'invalid_request';
  return new AiBridgeError(code, messages.join('; '));
}
