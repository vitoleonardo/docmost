import 'reflect-metadata';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { getMetadataStorage } from 'class-validator';
import { AiBridgeError } from '../ai-bridge.errors';

type Controller = abstract new (...args: never[]) => object;

interface RouteArgument {
  index: number;
}

@Injectable()
export class KnownBodyFieldsGuard implements CanActivate {
  private readonly allowedByHandler = new WeakMap<object, Set<string>>();

  canActivate(context: ExecutionContext): boolean {
    const body: unknown = context.switchToHttp().getRequest().body;
    if (body === null || typeof body !== 'object') return true;

    const allowed = this.allowedFields(context);
    const unknown = Object.keys(body).filter((field) => !allowed.has(field));
    if (unknown.length > 0) {
      throw new AiBridgeError(
        'invalid_request',
        `The request has fields the contract does not list: ${unknown.join(', ')}`,
      );
    }
    return true;
  }

  private allowedFields(context: ExecutionContext): Set<string> {
    const handler = context.getHandler();
    let allowed = this.allowedByHandler.get(handler);
    if (!allowed) {
      allowed = bodyDtoFields(context.getClass(), handler.name);
      this.allowedByHandler.set(handler, allowed);
    }
    return allowed;
  }
}

function bodyDtoFields(
  controller: Controller,
  handlerName: string,
): Set<string> {
  const args: Record<string, RouteArgument> =
    Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handlerName) ?? {};
  const bodyKey = Object.keys(args).find((key) =>
    key.startsWith(`${RouteParamtypes.BODY}:`),
  );
  if (!bodyKey) return new Set();
  const paramTypes: Controller[] = Reflect.getMetadata(
    'design:paramtypes',
    controller.prototype,
    handlerName,
  );
  const dto = paramTypes[args[bodyKey].index];
  return new Set(
    getMetadataStorage()
      .getTargetValidationMetadatas(dto, '', false, false)
      .map((metadata) => metadata.propertyName),
  );
}
