export interface AuditEntry {
  id: string;
  actorId: string;
  actorRole: string;
  /** Dotted action name such as `order.status` or `product.delete`. */
  action: string;
  targetId: string | null;
  /** Short, non-sensitive detail (for example the requested order status). Never a request body. */
  detail: string | null;
  createdAt: Date;
}
export type NewAuditEntry = Omit<AuditEntry, 'id' | 'createdAt'>;

/** Append-only: there is deliberately no update or delete. */
export abstract class AuditRepository {
  abstract record(entry: NewAuditEntry): Promise<void>;
  /** Newest first. */
  abstract findPage(page: number, limit: number): Promise<{ items: AuditEntry[]; total: number }>;
}
