import { randomBytes } from 'node:crypto';
import { JOB_STATUSES, JobStatus } from '../../src/jobs/job.schema';
import { JobRecord, JobsRepository } from '../../src/jobs/jobs.repository';

/** Test-only fake of the job store, with the same claiming rules as the Mongo repository. */
export class InMemoryJobsRepository extends JobsRepository {
  readonly records = new Map<string, JobRecord>();

  async enqueue(job: Pick<JobRecord, 'type' | 'payload' | 'maxAttempts' | 'runAt' | 'requestId'>) {
    const r: JobRecord = {
      ...job,
      id: randomBytes(12).toString('hex'),
      status: 'PENDING',
      attempts: 0,
      lockedUntil: null,
      lastError: null,
      createdAt: new Date(),
      finishedAt: null,
    };
    this.records.set(r.id, r);
    return { ...r };
  }
  async claimNext(now: Date, lockMs: number) {
    const due = [...this.records.values()]
      .filter(
        (j) =>
          j.runAt <= now &&
          (j.status === 'PENDING' ||
            (j.status === 'RUNNING' && j.lockedUntil !== null && j.lockedUntil < now)),
      )
      .sort((a, b) => a.runAt.getTime() - b.runAt.getTime())[0];
    if (!due) return null;
    Object.assign(due, {
      status: 'RUNNING',
      lockedUntil: new Date(now.getTime() + lockMs),
      attempts: due.attempts + 1,
    });
    return { ...due };
  }
  async complete(id: string, at: Date) {
    const j = this.records.get(id);
    if (j?.status === 'RUNNING')
      Object.assign(j, {
        status: 'DONE',
        payload: null,
        lockedUntil: null,
        finishedAt: at,
        lastError: null,
      });
  }
  async fail(id: string, error: string, retryAt: Date | null) {
    const j = this.records.get(id);
    if (j?.status !== 'RUNNING') return;
    Object.assign(
      j,
      retryAt
        ? { status: 'PENDING', runAt: retryAt, lockedUntil: null, lastError: error }
        : { status: 'DEAD', lockedUntil: null, lastError: error },
    );
  }
  async list(status: JobStatus | undefined, limit: number) {
    return [...this.records.values()].filter((j) => !status || j.status === status).slice(0, limit);
  }
  async counts() {
    const out = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
    for (const j of this.records.values()) out[j.status]++;
    return out;
  }
  async retry(id: string, now: Date) {
    const j = this.records.get(id);
    if (!j || j.status !== 'DEAD') return null;
    Object.assign(j, { status: 'PENDING', attempts: 0, runAt: now, lastError: null });
    return { ...j };
  }
}
