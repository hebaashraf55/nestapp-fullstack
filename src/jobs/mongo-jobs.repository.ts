import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Job, JOB_STATUSES, JobStatus } from './job.schema';
import { JobRecord, JobsRepository } from './jobs.repository';

type Doc = Job & { _id: Types.ObjectId; createdAt: Date };
const toRecord = (d: Doc): JobRecord => ({
  id: d._id.toString(),
  type: d.type,
  payload: d.payload ?? null,
  status: d.status,
  attempts: d.attempts,
  maxAttempts: d.maxAttempts,
  runAt: d.runAt,
  lockedUntil: d.lockedUntil ?? null,
  lastError: d.lastError ?? null,
  requestId: d.requestId ?? null,
  createdAt: d.createdAt,
  finishedAt: d.finishedAt ?? null,
});

@Injectable()
export class MongoJobsRepository extends JobsRepository {
  constructor(@InjectModel(Job.name) private readonly model: Model<Job>) {
    super();
  }

  async enqueue(job: Pick<JobRecord, 'type' | 'payload' | 'maxAttempts' | 'runAt' | 'requestId'>) {
    const doc = await this.model.create({ ...job, status: 'PENDING', attempts: 0 });
    return toRecord(doc.toObject() as unknown as Doc);
  }

  async claimNext(now: Date, lockMs: number) {
    const d = await this.model
      .findOneAndUpdate(
        {
          runAt: { $lte: now },
          $or: [{ status: 'PENDING' }, { status: 'RUNNING', lockedUntil: { $lt: now } }],
        },
        {
          $set: { status: 'RUNNING', lockedUntil: new Date(now.getTime() + lockMs) },
          $inc: { attempts: 1 },
        },
        { new: true, sort: { runAt: 1, _id: 1 } },
      )
      .lean<Doc>()
      .exec();
    return d ? toRecord(d) : null;
  }

  async complete(id: string, at: Date) {
    await this.model
      .updateOne(
        { _id: id, status: 'RUNNING' },
        {
          $set: {
            status: 'DONE',
            payload: null,
            lockedUntil: null,
            finishedAt: at,
            lastError: null,
          },
        },
      )
      .exec();
  }

  async fail(id: string, error: string, retryAt: Date | null, _at: Date) {
    await this.model
      .updateOne(
        { _id: id, status: 'RUNNING' },
        {
          $set: retryAt
            ? { status: 'PENDING', runAt: retryAt, lockedUntil: null, lastError: error }
            : { status: 'DEAD', lockedUntil: null, lastError: error, finishedAt: null },
        },
      )
      .exec();
  }

  async list(status: JobStatus | undefined, limit: number) {
    const docs = await this.model
      .find(status ? { status: { $eq: status } } : {})
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<Doc[]>()
      .exec();
    return docs.map(toRecord);
  }

  async counts() {
    const rows = await this.model
      .aggregate<{ _id: JobStatus; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }])
      .exec();
    const out = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
    for (const r of rows) out[r._id] = r.n;
    return out;
  }

  async retry(id: string, now: Date) {
    if (!isValidObjectId(id)) return null;
    const d = await this.model
      .findOneAndUpdate(
        { _id: id, status: 'DEAD' },
        { $set: { status: 'PENDING', attempts: 0, runAt: now, lastError: null } },
        { new: true },
      )
      .lean<Doc>()
      .exec();
    return d ? toRecord(d) : null;
  }
}
