import {
  Body,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  InternalServerErrorException,
  type NestInterceptor,
  Param,
  type PipeTransform,
  Query,
  SetMetadata,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBody, ApiParam, ApiQuery, ApiResponse, type SchemaObject } from '@nestjs/swagger';
import { map, type Observable } from 'rxjs';
import { z } from 'zod';

/*
 * Validation with the zod schemas of @fabric/contracts, the "nestjs-zod or equivalent" of
 * BUILD_PROMPTS 2.1 (nestjs-zod does not support Nest 12 yet). Handlers take their input
 * through ZodBody / ZodQuery / ZodParam (lint forbids the bare @Body, @Query and @Param in
 * modules) and declare their output with ZodResponse, which also strips unknown fields.
 * The same schemas generate the OpenAPI document.
 */

/** A zod schema as an OpenAPI 3.0 schema (zod's own JSON Schema output). */
export function toOpenApiSchema(schema: z.ZodType, io: 'input' | 'output'): SchemaObject {
  // zod's openapi-3.0 output is an OpenAPI schema object; swagger only types it more loosely.
  return z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as SchemaObject;
}

/** Thrown on invalid input; the exception filter turns it into `validation_failed` with issues. */
export class ValidationFailedException extends Error {
  override readonly name = 'ValidationFailedException';
  constructor(
    readonly error: z.ZodError,
    /** Prefix for issue paths, e.g. ['value'] when validating one field of a body. */
    readonly pathPrefix: readonly (string | number)[] = [],
  ) {
    super('Invalid input');
  }
}

/** zod issues in the API's error shape (`validation_failed`). */
export function issuesOf(
  error: z.ZodError,
  pathPrefix: readonly (string | number)[] = [],
): { path: (string | number)[]; message: string; code: string }[] {
  return error.issues.map((issue) => ({
    path: [
      ...pathPrefix,
      ...issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part)),
    ],
    message: issue.message,
    code: issue.code,
  }));
}

export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) throw new ValidationFailedException(result.error);
    return result.data;
  }
}

/** Describes the request body in OpenAPI from inside a parameter decorator. */
function documentMethod(
  target: object,
  key: string | symbol | undefined,
  decorator: MethodDecorator,
): void {
  if (key === undefined) throw new Error('Zod parameter decorators are for handler methods only');
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor) throw new Error(`no method ${String(key)} to document`);
  decorator(target, key, descriptor);
}

/** `@ZodBody(schema) body: z.infer<typeof schema>`: validated body, documented. */
export function ZodBody(schema: z.ZodType): ParameterDecorator {
  return (target, key, index) => {
    documentMethod(target, key, ApiBody({ schema: toOpenApiSchema(schema, 'input') }));
    Body(new ZodValidationPipe(schema))(target, key, index);
  };
}

/** `@ZodQuery(objectSchema) query`: validated query string, each field documented. */
export function ZodQuery(schema: z.ZodObject): ParameterDecorator {
  return (target, key, index) => {
    const json = toOpenApiSchema(schema, 'input');
    const required = new Set(json.required ?? []);
    for (const [name, property] of Object.entries(json.properties ?? {})) {
      documentMethod(
        target,
        key,
        ApiQuery({ name, required: required.has(name), schema: property }),
      );
    }
    Query(new ZodValidationPipe(schema))(target, key, index);
  };
}

/** `@ZodParam('key', schema) key`: one validated, documented path parameter. */
export function ZodParam(name: string, schema: z.ZodType): ParameterDecorator {
  return (target, key, index) => {
    documentMethod(target, key, ApiParam({ name, schema: toOpenApiSchema(schema, 'input') }));
    Param(name, new ZodValidationPipe(schema))(target, key, index);
  };
}

const RESPONSE_SCHEMA = Symbol('zod-response-schema');

/** The handler's response: documented, and parsed on the way out (unknown fields dropped). */
export function ZodResponse(schema: z.ZodType, status = 200): MethodDecorator {
  return applyDecorators(
    SetMetadata(RESPONSE_SCHEMA, schema),
    ApiResponse({ status, schema: toOpenApiSchema(schema, 'output') }),
  );
}

/** Applies ZodResponse schemas. A response that does not fit is a bug: 500, never sent. */
@Injectable()
export class ZodSerializerInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.get<z.ZodType | undefined>(RESPONSE_SCHEMA, context.getHandler());
    if (!schema) return next.handle();
    return next.handle().pipe(
      map((data: unknown) => {
        const result = schema.safeParse(data);
        if (!result.success) {
          throw new InternalServerErrorException(
            `response does not match its schema: ${z.prettifyError(result.error)}`,
          );
        }
        return result.data;
      }),
    );
  }
}
