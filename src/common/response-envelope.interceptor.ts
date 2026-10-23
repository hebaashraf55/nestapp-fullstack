import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface SuccessEnvelope<T> {
  success: true;
  data: T | null;
  timestamp: string;
}

/**
 * Wraps every successful response as `{ success, data, timestamp }`. This is the same envelope the
 * original NestApp API used, so existing clients keep working.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) return data;
        const envelope: SuccessEnvelope<T> = {
          success: true,
          data: data ?? null,
          timestamp: new Date().toISOString(),
        };
        return envelope;
      }),
    );
  }
}
