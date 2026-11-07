import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Notification } from './notification.schema';
import {
  NewNotification,
  NotificationRecord,
  NotificationsRepository,
} from './notifications.repository';

type Doc = Notification & { _id: Types.ObjectId; createdAt: Date };
const toRecord = (d: Doc): NotificationRecord => ({
  id: d._id.toString(),
  userId: d.userId,
  type: d.type,
  title: d.title,
  body: d.body ?? '',
  link: d.link ?? null,
  readAt: d.readAt ?? null,
  createdAt: d.createdAt,
});
const bad = (userId: unknown) => typeof userId !== 'string' || userId === '';

@Injectable()
export class MongoNotificationsRepository extends NotificationsRepository {
  constructor(@InjectModel(Notification.name) private readonly model: Model<Notification>) {
    super();
  }

  async create(n: NewNotification) {
    const doc = await this.model.create({ ...n, readAt: null });
    return toRecord(doc.toObject() as unknown as Doc);
  }

  async listByUser(userId: string, limit: number) {
    if (bad(userId)) return [];
    const docs = await this.model
      .find({ userId: { $eq: userId } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean<Doc[]>()
      .exec();
    return docs.map(toRecord);
  }

  countUnread(userId: string) {
    if (bad(userId)) return Promise.resolve(0);
    return this.model.countDocuments({ userId: { $eq: userId }, readAt: null }).exec();
  }

  async markRead(id: string, userId: string, at: Date) {
    if (bad(userId) || !isValidObjectId(id)) return false;
    const r = await this.model
      .updateOne({ _id: new Types.ObjectId(id), userId: { $eq: userId } }, [
        { $set: { readAt: { $ifNull: ['$readAt', at] } } },
      ])
      .exec();
    return r.matchedCount === 1;
  }

  async markAllRead(userId: string, at: Date) {
    if (bad(userId)) return 0;
    const r = await this.model
      .updateMany({ userId: { $eq: userId }, readAt: null }, { $set: { readAt: at } })
      .exec();
    return r.modifiedCount;
  }
}
