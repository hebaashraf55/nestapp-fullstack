import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InventoryMovement } from './movement.schema';
import {
  InventoryRepository,
  MovementFilter,
  MovementRecord,
  NewMovement,
} from './inventory.repository';

type Doc = InventoryMovement & { _id: Types.ObjectId; createdAt: Date };
const toRecord = (d: Doc): MovementRecord => ({
  id: d._id.toString(),
  productId: d.productId,
  productName: d.productName,
  change: d.change,
  reason: d.reason,
  note: d.note ?? null,
  orderId: d.orderId ?? null,
  actorId: d.actorId ?? null,
  isDemo: d.isDemo === true,
  createdAt: d.createdAt,
});

@Injectable()
export class MongoInventoryRepository extends InventoryRepository {
  constructor(
    @InjectModel(InventoryMovement.name) private readonly model: Model<InventoryMovement>,
  ) {
    super();
  }

  async append(entries: NewMovement[]) {
    // Ordered: an invalid entry is refused instead of being silently skipped.
    if (entries.length) await this.model.insertMany(entries);
  }

  async findPage(f: MovementFilter) {
    const query: Record<string, unknown> = {};
    if (f.productId !== undefined) query.productId = { $eq: String(f.productId) };
    if (f.reason !== undefined) query.reason = { $eq: f.reason };
    if (f.demoOnly) query.isDemo = true;
    const [docs, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip((f.page - 1) * f.limit)
        .limit(f.limit)
        .lean<Doc[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { items: docs.map(toRecord), total };
  }
}
