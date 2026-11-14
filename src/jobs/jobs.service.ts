import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { redactText } from '../common/redact';
import { currentRequestId, requestContext } from '../common/request-context';
import { ENV, Env } from '../config/env';
import { MailSender } from '../mail/mail-sender';
import { JobStatus } from './job.schema';
import { JobRecord, JobsRepository } from './jobs.repository';

export type JobHandler = (payload: unknown) => Promise<void>;

const POLL_MS = 2000;
const LOCK_MS = 60_000;
const BATCH = 20;

/** 10 s, 20 s, 40 s… up to an hour, with a little jitter so retries do not arrive together. */
export const backoffMs = (attempt: number, random = Math.random) =>
  Math.min(60 * 60 * 1000, 10_000 * 2 ** Math.max(0, attempt - 1)) * (0.8 + 0.4 * random());

export interface JobView {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lastError: string | null;
  requestId: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}
/** Payloads (an email's text, a link) are never sent to the admin screen. */
const view = ({ payload: _p, lockedUntil: _l, ...rest }: JobRecord): JobView => rest;

/**
 * Durable background work: jobs are stored in MongoDB, so they survive a restart, and run by a worker
 * that polls every two seconds. Each attempt is claimed atomically (safe with several instances); a
 * failure is retried with exponential back-off until `maxAttempts`, then the job is DEAD and an admin
 * can retry it. Handlers must be safe to run twice (a worker can die after the work but before the
 * job is marked done).
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  now: () => number = Date.now;

  constructor(
    private readonly repo: JobsRepository,
    @Inject(ENV) private readonly env: Env,
    mail: MailSender,
  ) {
    this.register('mail.send', async (payload) => {
      const p = payload as { to?: unknown; subject?: unknown; text?: unknown };
      if (typeof p?.to !== 'string' || typeof p.subject !== 'string' || typeof p.text !== 'string')
        throw new Error('mail.send: malformed payload');
      await mail.send({ to: p.to, subject: p.subject, text: p.text });
    });
  }

  register(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  async enqueue(
    type: string,
    payload: unknown,
    opts: { maxAttempts?: number; delayMs?: number } = {},
  ): Promise<string> {
    if (!this.handlers.has(type)) throw new Error(`No handler for job type ${type}`);
    const job = await this.repo.enqueue({
      type,
      payload,
      maxAttempts: opts.maxAttempts ?? 5,
      runAt: new Date(this.now() + (opts.delayMs ?? 0)),
      requestId: currentRequestId() ?? null,
    });
    // Serverless (Vercel) has no worker between requests: try it right away; if it fails, the job stays
    // queued and can be retried from Admin -> Jobs.
    if (process.env.VERCEL) await this.runDue(1).catch(() => undefined);
    return job.id;
  }

  /** Runs every due job once (the worker calls this; tests call it directly). Returns how many ran. */
  async runDue(max = BATCH): Promise<number> {
    let ran = 0;
    for (; ran < max; ran++) {
      const job = await this.repo.claimNext(new Date(this.now()), LOCK_MS);
      if (!job) break;
      await requestContext.run({ requestId: job.requestId ?? `job-${job.id}` }, () =>
        this.execute(job),
      );
    }
    return ran;
  }

  private async execute(job: JobRecord) {
    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await handler(job.payload);
      await this.repo.complete(job.id, new Date(this.now()));
    } catch (error) {
      const message = redactText(error instanceof Error ? error.message : String(error)).slice(
        0,
        500,
      );
      const last = job.attempts >= job.maxAttempts;
      await this.repo.fail(
        job.id,
        message,
        last ? null : new Date(this.now() + backoffMs(job.attempts)),
        new Date(this.now()),
      );
      if (last)
        this.logger.error(
          `Job ${job.type} ${job.id} failed ${job.attempts} times and is dead: ${message}`,
        );
      else
        this.logger.warn(
          `Job ${job.type} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}), will retry: ${message}`,
        );
    }
  }

  async list(status?: JobStatus) {
    const [items, counts] = await Promise.all([this.repo.list(status, 100), this.repo.counts()]);
    return { counts, items: items.map(view) };
  }

  async retry(id: string): Promise<JobView> {
    const job = await this.repo.retry(id, new Date(this.now()));
    if (!job) throw new NotFoundException('No dead job with that id');
    return view(job);
  }

  get workerRunning() {
    return this.timer !== null;
  }

  onApplicationBootstrap() {
    if (
      this.env.JOBS_WORKER === 'off' ||
      this.env.NODE_ENV === 'test' ||
      !this.env.MONGODB_URI ||
      process.env.VERCEL
    )
      return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.runDue()
        .catch((error: unknown) => this.logger.error(`Job worker: ${String(error)}`))
        .finally(() => {
          this.running = false;
        });
    }, POLL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
