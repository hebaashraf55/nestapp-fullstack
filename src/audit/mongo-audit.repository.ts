import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditEntry, AuditRepository, NewAuditEntry } from './audit.repository';
import { AuditLog } from './audit.schema';

interface AuditDoc {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  targetId?: string | null;
  detail?: string | null;
  createdAt: Date;
}

const toEntry = (d: AuditDoc): AuditEntry => ({
  id: d.id,
  actorId: d.actorId,
  actorRole: d.actorRole,
  action: d.action,
  targetId: d.targetId ?? null,
  detail: d.detail ?? null,
  createdAt: d.createdAt,
});

@Injectable()
export class MongoAuditRepository extends AuditRepository {
  constructor(@InjectModel(AuditLog.name) private readonly model: Model<AuditLog>) {
    super();
  }

  async record(entry: NewAuditEntry): Promise<void> {
    await this.model.create(entry);
  }

  async findPage(page: number, limit: number) {
    const [docs, total] = await Promise.all([
      this.model
        .find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.model.countDocuments({}).exec(),
    ]);
    return { items: docs.map((d) => toEntry(d as unknown as AuditDoc)), total };
  }
}
