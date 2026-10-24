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

import { runRetention } from './retention';
import { createPrisma } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';
import { logFinalFailure } from '../job-failures';
import { inJob } from '../logging';
import { StorageService } from '../storage/storage.service';

export const RETENTION_QUEUE = 'retention';
const NIGHTLY_JOB = 'retention-nightly';
// After the system log's purge at 03:30, in the quiet of the night.
const NIGHTLY = { pattern: '0 4 * * *', tz: 'Europe/Bucharest' };

interface RetentionOptions {
  databaseUrl: string;
  redisUrl: string;
}

const OPTIONS = Symbol('RETENTION_OPTIONS');

// The nightly job that enforces the retention periods the privacy notice
// states: one repeatable job under a fixed scheduler id, so however many
// workers start it runs once a night.
@Injectable()
class RetentionJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Retention');
  private readonly prisma: PrismaClient;
  private readonly jobs: Queue;
  private readonly worker: Worker;

  constructor(
    @Inject(OPTIONS) options: RetentionOptions,
    storage: StorageService,
  ) {
    this.prisma = createPrisma(options.databaseUrl);
    const connection = { maxRetriesPerRequest: null, url: options.redisUrl };
    this.jobs = new Queue(RETENTION_QUEUE, {
      connection,
      telemetry: queueTelemetry(),
    });
    observeQueue(this.jobs);
    const deps = { logger: this.logger, prisma: this.prisma, storage };
    this.worker = new Worker(
      RETENTION_QUEUE,
      (job) => inJob(job, () => runRetention(deps, new Date())),
      { connection, telemetry: queueTelemetry() },
    );
    logFinalFailure(this.worker, this.logger);
    observeWorker(this.worker, { jobNames: [NIGHTLY_JOB] });
  }

  async onApplicationBootstrap() {
    await this.jobs.upsertJobScheduler(NIGHTLY_JOB, NIGHTLY, {
      name: NIGHTLY_JOB,
      opts: {
        attempts: 3,
        backoff: { delay: 60_000, type: 'exponential' },
        removeOnComplete: true,
        removeOnFail: 10,
      },
    });
  }

  async onApplicationShutdown() {
    await this.worker.close();
    await this.jobs.close();
    await this.prisma.$disconnect();
  }
}

@Module({})
export class RetentionModule {
  static registerWorker(options: RetentionOptions): DynamicModule {
    return {
      module: RetentionModule,
      providers: [{ provide: OPTIONS, useValue: options }, RetentionJobs],
    };
  }
}
