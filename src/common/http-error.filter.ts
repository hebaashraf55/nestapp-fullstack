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
 * Unexpected errors always produce a generic 500: their message and stack are logged on the server
 * and never sent to the client.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { statusCode, message, details } = this.describe(exception);

    if (statusCode >= 500) {
      this.logger.error(
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
      );
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
    response.status(statusCode).json(body);
  }

  private describe(exception: unknown): Described {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
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
