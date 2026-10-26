import { SetMetadata } from '@nestjs/common';

export const AUDITED = 'audit:action';

export interface AuditedMeta {
  action: string;
  /** Name of a string body field to keep as the entry's short detail (for example `status`). */
  detailField?: string;
}

/** Marks an admin write route so that every successful call is recorded in the audit log. */
export const Audited = (action: string, detailField?: string) =>
  SetMetadata<string, AuditedMeta>(AUDITED, { action, detailField });
