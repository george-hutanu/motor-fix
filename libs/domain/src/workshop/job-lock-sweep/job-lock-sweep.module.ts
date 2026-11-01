import {
  observeQueue,
  observeWorker,
  queueTelemetry,
} from '@motor-fix/observability';
import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import { JobLockSweep } from './job-lock-sweep.service';
import { AUTH_REDIS } from '../../auth/attempts';
import { createPrisma, PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';
import { borrowStore, returnStore } from '../../store/store';

const SWEEP_JOB = 'job-lock-sweep';
const EVERY_MS = 60_000;

interface JobLockSweepOptions {
  databaseUrl: string;
  redisUrl: string;
}

const OPTIONS = Symbol('JOB_LOCK_SWEEP_OPTIONS');

// One repeatable job every minute under a fixed scheduler id, so however
// many workers start it the sweep runs once a minute.
@Injectable()
class JobLockSweepJobs
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('JobLockSweep');
  private readonly jobs: Queue;
  private readonly worker: Worker;

  constructor(
    @Inject(OPTIONS) options: JobLockSweepOptions,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_REDIS) private readonly redis: Redis,
    sweep: JobLockSweep,
  ) {
    const connection = { maxRetriesPerRequest: null, url: options.redisUrl };
    this.jobs = new Queue('job-locks', {
      connection,
      telemetry: queueTelemetry(),
    });
    observeQueue(this.jobs);
    this.worker = new Worker(
      'job-locks',
      (job) => inJob(job, () => sweep.sweep()),
      { connection, telemetry: queueTelemetry() },
    );
    logFinalFailure(this.worker, this.logger);
    observeWorker(this.worker, { jobNames: [SWEEP_JOB] });
  }

  async onApplicationBootstrap() {
    await this.jobs.upsertJobScheduler(
      SWEEP_JOB,
      { every: EVERY_MS },
      { name: SWEEP_JOB, opts: { removeOnComplete: true, removeOnFail: 10 } },
    );
  }

  async onApplicationShutdown() {
    await this.worker.close();
    await this.jobs.close();
    await returnStore(this.redis);
    await this.prisma.$disconnect();
  }
}

// Imported as it is, the sweep runs on the app's own database and store;
// the worker registers it with its own and a once-a-minute schedule.
@Module({ exports: [JobLockSweep], providers: [JobLockSweep] })
export class JobLockSweepModule {
  static registerWorker(options: JobLockSweepOptions): DynamicModule {
    return {
      module: JobLockSweepModule,
      providers: [
        { provide: OPTIONS, useValue: options },
        {
          provide: PRISMA,
          useFactory: () => createPrisma(options.databaseUrl),
        },
        {
          provide: AUTH_REDIS,
          useFactory: () => borrowStore(options.redisUrl),
        },
        JobLockSweep,
        JobLockSweepJobs,
      ],
    };
  }
}
