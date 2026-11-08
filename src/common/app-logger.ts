import { ConsoleLogger } from '@nestjs/common';
import { redact, redactText } from './redact';
import { currentRequestId } from './request-context';

/**
 * The application logger. JSON lines in production (one object per line: level, time, context,
 * message, requestId), readable text in development. Every message is redacted first, so a secret that
 * slips into an error message or a logged object never reaches the log.
 */
export class AppLogger extends ConsoleLogger {
  constructor(json: boolean) {
    super({ json, timestamp: !json, compact: json });
  }

  private scrub(message: unknown): unknown {
    const clean = typeof message === 'string' ? redactText(message) : redact(message);
    const id = currentRequestId();
    if (!id) return clean;
    return typeof clean === 'string'
      ? `${clean} [req ${id}]`
      : { requestId: id, ...(clean as object) };
  }

  override log(message: unknown, ...rest: unknown[]) {
    super.log(this.scrub(message), ...rest);
  }
  override warn(message: unknown, ...rest: unknown[]) {
    super.warn(this.scrub(message), ...rest);
  }
  override error(message: unknown, ...rest: unknown[]) {
    // A stack trace passed as the second argument is scrubbed too.
    super.error(
      this.scrub(message),
      ...rest.map((r) => (typeof r === 'string' ? redactText(r) : r)),
    );
  }
  override debug(message: unknown, ...rest: unknown[]) {
    super.debug(this.scrub(message), ...rest);
  }
  override verbose(message: unknown, ...rest: unknown[]) {
    super.verbose(this.scrub(message), ...rest);
  }
}
