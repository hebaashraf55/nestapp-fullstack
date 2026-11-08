import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface RequestContext {
  requestId: string;
}

/** The current request's id, readable from anywhere in that request (logs, errors, jobs it enqueues). */
export const requestContext = new AsyncLocalStorage<RequestContext>();
export const currentRequestId = (): string | undefined => requestContext.getStore()?.requestId;

const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;
const QUIET = /^\/api(?:\/v1)?\/health(?:\/|$)/;

/**
 * Gives every request a correlation id: a well-formed incoming X-Request-Id is kept (so a proxy's id
 * flows through), anything else is replaced. The id is returned in the response header and attached to
 * every log line of the request. One access log line is written per request (health checks excluded),
 * without the query string, so no token or code in a URL can reach the logs.
 */
export function requestContextMiddleware() {
  const logger = new Logger('HTTP');
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    const requestId = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    const path = req.originalUrl.split('?')[0] ?? '';
    requestContext.run({ requestId }, () => {
      res.on('finish', () => {
        if (QUIET.test(path)) return;
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        const line = `${req.method} ${path} ${res.statusCode} ${ms.toFixed(1)}ms`;
        requestContext.run({ requestId }, () => {
          if (res.statusCode >= 500) logger.error(line);
          else if (res.statusCode >= 400) logger.warn(line);
          else logger.log(line);
        });
      });
      next();
    });
  };
}
