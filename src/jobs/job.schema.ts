import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export const JOB_STATUSES = ['PENDING', 'RUNNING', 'DONE', 'DEAD'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

@Schema({ collection: 'jobs', timestamps: { createdAt: true, updatedAt: true } })
export class Job {
  @Prop({ required: true, maxlength: 60 })
  type!: string;

  /** What the handler needs. Cleared once the job succeeds, so finished jobs keep no message content. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  payload!: unknown;

  @Prop({ required: true, enum: JOB_STATUSES, default: 'PENDING' })
  status!: JobStatus;

  @Prop({ required: true, default: 0, min: 0 })
  attempts!: number;

  @Prop({ required: true, default: 5, min: 1, max: 20 })
  maxAttempts!: number;

  @Prop({ required: true, type: Date })
  runAt!: Date;

  /** While RUNNING: when another worker may take the job over (the first one is presumed gone). */
  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;

  /** Redacted, shortened. */
  @Prop({ type: String, default: null, maxlength: 500 })
  lastError!: string | null;

  @Prop({ type: String, default: null })
  requestId!: string | null;

  @Prop({ type: Date, default: null })
  finishedAt!: Date | null;
}
export type JobDocument = HydratedDocument<Job>;
export const JobSchema = SchemaFactory.createForClass(Job);
JobSchema.index({ status: 1, runAt: 1 });
// Finished jobs are removed after 14 days; dead ones are kept until an admin retries them.
JobSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 14 * 24 * 3600 });
