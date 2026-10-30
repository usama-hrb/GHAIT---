import { randomUUID } from 'node:crypto';
import { HEADERS } from '@fabric/contracts';
import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfig } from '../config/index.js';

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * JSON logs (pino) with one request id per request: taken from x-request-id when it looks safe,
 * generated otherwise, and sent back in the response header. Secrets are redacted; bodies are
 * never logged.
 */
export function loggingModule(config: AppConfig): DynamicModule {
  return LoggerModule.forRoot({
    pinoHttp: {
      level: config.logLevel,
      genReqId: (request, response) => {
        const incoming = request.headers[HEADERS.requestId];
        const id =
          typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
        response.setHeader(HEADERS.requestId, id);
        return id;
      },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
      autoLogging: { ignore: (request) => request.url === '/health' },
      customLogLevel: (_request, response, error) =>
        error || response.statusCode >= 500
          ? 'error'
          : response.statusCode >= 400
            ? 'warn'
            : 'info',
    },
  });
}
