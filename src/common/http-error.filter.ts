import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { STATUS_CODES } from 'node:http';

export interface ErrorEnvelope {
  success: false;
  error: {
    statusCode: number;
    error: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

interface Described {
  statusCode: number;
  message: string;
  details?: unknown;
}

/** Shape of errors raised by Express middleware such as body-parser (the `http-errors` package). */
interface HttpLikeError {
  status?: unknown;
  statusCode?: unknown;
  expose?: unknown;
  type?: unknown;
}

/**
 * Turns every error into `{ success: false, error: {...}, timestamp }` with the real HTTP status.
 * Every 5xx (unexpected errors and developer-thrown HttpExceptions alike) produces a fixed, generic
 * body: the real message and stack are logged on the server and never sent to the client. Messages of
 * 4xx errors are intentional client feedback and are kept.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const described = this.describe(exception);
    const { statusCode } = described;
    let { message, details } = described;

    if (statusCode >= 500) {
      // Log the real cause server-side only; the client always gets a fixed, generic body.
      this.logger.error(
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
      );
      message =
        statusCode === 500 ? 'Internal server error' : (STATUS_CODES[statusCode] ?? 'Error');
      details = undefined;
    }

    const body: ErrorEnvelope = {
      success: false,
      error: {
        statusCode,
        error: STATUS_CODES[statusCode] ?? 'Error',
        message,
        ...(details !== undefined ? { details } : {}),
      },
      timestamp: new Date().toISOString(),
    };
    const retryAfter = (exception as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
    if (statusCode === 429 && typeof retryAfter === 'number') {
      response.setHeader('Retry-After', String(retryAfter));
    }
    response.status(statusCode).json(body);
  }

  private describe(exception: unknown): Described {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      // Express rejects an undecodable route param with a URIError whose text quotes the input; Nest
      // wraps it in a BadRequestException with that text.
      if (statusCode === 400 && /^Failed to decode param/.test(exception.message)) {
        return { statusCode, message: 'Malformed URL parameter' };
      }
      const payload = exception.getResponse();
      if (typeof payload === 'string') return { statusCode, message: payload };
      const record = payload as Record<string, unknown>;
      const raw = record.message;
      if (typeof raw === 'string') return { statusCode, message: raw, details: record.details };
      if (raw !== undefined) {
        return { statusCode, message: STATUS_CODES[statusCode] ?? 'Error', details: raw };
      }
      return { statusCode, message: exception.message, details: record.details };
    }

    if (typeof exception === 'object' && exception !== null) {
      const candidate = exception as HttpLikeError;
      const status = Number(candidate.status ?? candidate.statusCode);
      if (Number.isInteger(status) && status >= 400 && status < 500 && candidate.expose === true) {
        if (candidate.type === 'entity.parse.failed') {
          return { statusCode: 400, message: 'Malformed JSON body' };
        }
        if (candidate.type === 'entity.too.large') {
          return { statusCode: 413, message: 'Request body too large' };
        }
        return { statusCode: status, message: STATUS_CODES[status] ?? 'Bad Request' };
      }
    }

    return { statusCode: 500, message: 'Internal server error' };
  }
}
