import { JobStatus } from './job.schema';

export interface JobRecord {
  id: string;
  type: string;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lockedUntil: Date | null;
  lastError: string | null;
  requestId: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export abstract class JobsRepository {
  abstract enqueue(
    job: Pick<JobRecord, 'type' | 'payload' | 'maxAttempts' | 'runAt' | 'requestId'>,
  ): Promise<JobRecord>;
  /**
   * Atomically takes the next due job (pending, or running with an expired lock), marks it RUNNING with
   * a lock and counts the attempt. Two workers can never take the same job.
   */
  abstract claimNext(now: Date, lockMs: number): Promise<JobRecord | null>;
  abstract complete(id: string, at: Date): Promise<void>;
  /** retryAt null = no attempts left: the job becomes DEAD. */
  abstract fail(id: string, error: string, retryAt: Date | null, at: Date): Promise<void>;
  abstract list(status: JobStatus | undefined, limit: number): Promise<JobRecord[]>;
  abstract counts(): Promise<Record<JobStatus, number>>;
  /** DEAD → PENDING with fresh attempts. Returns null if the job is not dead. */
  abstract retry(id: string, now: Date): Promise<JobRecord | null>;
}
