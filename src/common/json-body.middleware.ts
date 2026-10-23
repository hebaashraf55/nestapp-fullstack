import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import express, { NextFunction, Request, RequestHandler, Response } from 'express';

interface BodyParserError {
  type?: unknown;
}

/**
 * Parses JSON request bodies and converts parser failures into fixed, safe messages.
 *
 * Why this exists: Nest turns any `SyntaxError` from the default body parser into
 * `BadRequestException(err.message)`, and that message quotes part of the client's payload. We parse
 * first, replace the error with a generic one, and let Nest's own parser skip the already-parsed body.
 */
export function jsonBody(limit = '100kb'): RequestHandler {
  const parser = express.json({ limit });
  return (req: Request, res: Response, next: NextFunction) => {
    parser(req, res, (error?: unknown) => {
      if (error === undefined) return next();
      const type = (error as BodyParserError | null)?.type;
      if (type === 'entity.parse.failed') {
        return next(new BadRequestException('Malformed JSON body'));
      }
      if (type === 'entity.too.large') {
        return next(new PayloadTooLargeException('Request body too large'));
      }
      return next(error);
    });
  };
}
