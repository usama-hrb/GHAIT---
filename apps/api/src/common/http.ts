import { errorResponseSchema } from '@fabric/contracts';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { toOpenApiSchema } from './zod.js';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

/** Every operation can fail with the one error shape (BUILD_PROMPTS 2.1). */
function withErrorResponses(document: OpenAPIObject): OpenAPIObject {
  document.components = {
    ...document.components,
    schemas: {
      ...document.components?.schemas,
      ErrorResponse: toOpenApiSchema(errorResponseSchema, 'output'),
    },
  };
  for (const path of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = path[method];
      if (!operation) continue;
      operation.responses.default ??= {
        description: 'Error (see `error.code`)',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
      };
    }
  }
  return document;
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Fabric Shop API')
    .setDescription(
      'Money is integer cents, lengths integer cm. Authenticate with POST /auth/login, then send ' +
        '`Authorization: Bearer <accessToken>`.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return withErrorResponses(SwaggerModule.createDocument(app, config));
}

/**
 * App-level setup shared by main.ts and the integration tests: pino as the Nest logger,
 * cookies, the proxy hop and the OpenAPI docs (/docs, JSON at /docs/json).
 */
export function configureHttp(app: NestExpressApplication): void {
  app.useLogger(app.get(Logger));
  // A sync push may carry a photo (~100-200 KB of base64): the default 100 KB would refuse it.
  app.useBodyParser('json', { limit: '4mb' });
  app.use(cookieParser());
  // Caddy (prod) is one hop away on the Docker network: client IPs for rate limiting.
  app.set('trust proxy', 'loopback, uniquelocal');
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), { jsonDocumentUrl: 'docs/json' });
}
