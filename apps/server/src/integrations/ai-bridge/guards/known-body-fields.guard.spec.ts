import { stub } from '../test-stub';
import 'reflect-metadata';
import { ArgumentsHost, Body, ExecutionContext } from '@nestjs/common';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { FastifyReply } from 'fastify';
import { AiBridgeController } from '../ai-bridge.controller';
import { AiBridgeError, AiBridgeErrorCode } from '../ai-bridge.errors';
import { AiBridgeExceptionFilter } from '../filters/ai-bridge-exception.filter';
import { KnownBodyFieldsGuard } from './known-body-fields.guard';

const SPACE_ID = '0b7c5e8a-0000-4000-8000-000000000001';

class ExampleDto {
  @IsUUID()
  pageId: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class RoutesUnderTest {
  withBody(@Body() _dto: ExampleDto) {}

  withoutBody() {}
}

type Controller = new (...args: never[]) => object;

function contextFor(
  controller: Controller,
  handlerName: string,
  body: unknown,
): ExecutionContext {
  return stub<ExecutionContext>({
    getClass: () => controller,
    getHandler: () =>
      (controller.prototype as Record<string, unknown>)[handlerName],
    switchToHttp: () => ({ getRequest: () => ({ body }) }),
  });
}

describe('KnownBodyFieldsGuard', () => {
  const guard = new KnownBodyFieldsGuard();

  const outcomeOf = (
    controller: Controller,
    handlerName: string,
    body: unknown,
  ): AiBridgeErrorCode | 'passed' => {
    try {
      guard.canActivate(contextFor(controller, handlerName, body));
      return 'passed';
    } catch (error) {
      if (error instanceof AiBridgeError) return error.code;
      throw error;
    }
  };

  it('AGENT-AC104: a run request with a field the contract does not list answers invalid_request', () => {
    expect(
      outcomeOf(AiBridgeController, 'agentRun', {
        spaceId: SPACE_ID,
        task: 'Aufgabe',
        model: 'qwen3:8b',
      }),
    ).toBe('invalid_request');
  });

  it('AGENT-AC104: a run request with only the fields of the contract passes to validation', () => {
    expect(
      outcomeOf(AiBridgeController, 'agentRun', {
        spaceId: SPACE_ID,
        task: 'Aufgabe',
      }),
    ).toBe('passed');
    expect(outcomeOf(AiBridgeController, 'agentRun', { task: 'Aufgabe' })).toBe(
      'passed',
    );
  });

  it('AGENT-AC104: the allowed fields are the properties of the body DTO of the handler', () => {
    expect(
      outcomeOf(RoutesUnderTest, 'withBody', { pageId: SPACE_ID, note: 'x' }),
    ).toBe('passed');
    expect(
      outcomeOf(RoutesUnderTest, 'withBody', { pageId: SPACE_ID, task: 'x' }),
    ).toBe('invalid_request');
    expect(
      outcomeOf(RoutesUnderTest, 'withBody', { pageId: SPACE_ID, userId: 'u' }),
    ).toBe('invalid_request');
  });

  it('AGENT-AC104: a handler without a body DTO allows no field', () => {
    expect(outcomeOf(RoutesUnderTest, 'withoutBody', {})).toBe('passed');
    expect(outcomeOf(RoutesUnderTest, 'withoutBody', { pageId: 'x' })).toBe(
      'invalid_request',
    );
  });

  it.each([
    ['no body', undefined],
    ['a null body', null],
    ['a string body', 'spaceId'],
  ])('AGENT-AC104: %s is left to the validation of the DTO', (_case, body) => {
    expect(outcomeOf(AiBridgeController, 'agentRun', body)).toBe('passed');
  });

  it('AGENT-AC104: the refusal names the unknown field and answers 400 through the bridge filter', () => {
    let refusal: unknown;
    try {
      guard.canActivate(
        contextFor(AiBridgeController, 'agentRun', {
          spaceId: SPACE_ID,
          task: 'Aufgabe',
          changes: [],
        }),
      );
    } catch (error) {
      refusal = error;
    }
    const send = jest.fn();
    const reply = { status: jest.fn(() => ({ send })) };

    new AiBridgeExceptionFilter().catch(
      refusal as AiBridgeError,
      stub<ArgumentsHost>({
        switchToHttp: () => ({ getResponse: () => stub<FastifyReply>(reply) }),
      }),
    );

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({
      code: 'invalid_request',
      message: expect.stringContaining('changes'),
    });
  });
});
