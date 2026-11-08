import {
  Body,
  Controller,
  DynamicModule,
  Get,
  Global,
  HttpCode,
  Injectable,
  Module,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { z } from 'zod';
import { Audited } from '../audit/audited';
import { Roles } from '../auth/decorators';
import { ZodPipe } from '../catalogue/dto';
import { ParseObjectIdPipe } from '../catalogue/object-id.pipe';
import { ENV, Env } from '../config/env';
import { emptyBodySchema } from '../orders/dto';
import { Role } from '../users/role';
import { Job, JOB_STATUSES, JobSchema } from './job.schema';
import { JobsRepository } from './jobs.repository';
import { JobsService } from './jobs.service';
import { MongoJobsRepository } from './mongo-jobs.repository';

const unavailable = (): never => {
  throw new ServiceUnavailableException();
};
/** Bound when MONGODB_URI is not set. */
@Injectable()
export class UnavailableJobsRepository extends JobsRepository {
  enqueue = unavailable;
  claimNext = unavailable;
  complete = unavailable;
  fail = unavailable;
  list = unavailable;
  counts = unavailable;
  retry = unavailable;
}

const jobsQuerySchema = z.strictObject({ status: z.enum(JOB_STATUSES).optional() });

/** Background jobs for staff: counts, recent jobs without their payloads, and retrying dead ones. */
@Roles(Role.ADMIN)
@Controller('admin/jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@Query(new ZodPipe(jobsQuerySchema)) q: z.infer<typeof jobsQuerySchema>) {
    return this.jobs.list(q.status);
  }

  @Audited('job.retry')
  @Post(':id/retry')
  @HttpCode(200)
  retry(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(emptyBodySchema)) _b: object,
  ) {
    return this.jobs.retry(id.toLowerCase());
  }
}

@Global()
@Module({})
export class JobsModule {
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: JobsModule,
      imports: connected
        ? [MongooseModule.forFeature([{ name: Job.name, schema: JobSchema }])]
        : [],
      controllers: [JobsController],
      providers: [
        { provide: ENV, useValue: env },
        {
          provide: JobsRepository,
          useClass: connected ? MongoJobsRepository : UnavailableJobsRepository,
        },
        JobsService,
      ],
      exports: [JobsService],
    };
  }
}
