import { Injectable, Logger } from '@nestjs/common';
import { AuditRepository, NewAuditEntry } from './audit.repository';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly entries: AuditRepository) {}

  /**
   * Called after the audited action has already succeeded, so a failure to write the entry cannot be
   * allowed to turn a completed action into an error response. It is logged loudly instead.
   */
  async record(entry: NewAuditEntry): Promise<void> {
    try {
      await this.entries.record(entry);
    } catch (error) {
      this.logger.error(
        `AUDIT WRITE FAILED for ${entry.action} by ${entry.actorId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  list(page: number, limit: number) {
    return this.entries.findPage(page, limit);
  }
}
