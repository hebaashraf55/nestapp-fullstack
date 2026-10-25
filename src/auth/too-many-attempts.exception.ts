import { HttpException, HttpStatus } from '@nestjs/common';

/** 429 with a generic message; the error filter turns `retryAfterSeconds` into a Retry-After header. */
export class TooManyAttemptsException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many attempts. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
  }
}
