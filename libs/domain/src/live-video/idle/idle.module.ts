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

import { LIVE_IDLE, LIVE_IDLE_QUEUE, stopIdleSessions } from './idle';
import { AuditService } from '../../audit/audit.service';
import { createPrisma } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';
import { type LiveVideoConfig, providerFor } from '../live-video.module';

const CHECK_JOB = 'live-idle-check';

interface LiveIdleOptions {
  databaseUrl: string;
  redisUrl: string;
  liveVideo: LiveVideoConfig;
}

const OPTIONS = Symbol('LIVE_IDLE_OPTIONS');

// The idle check: one repeatable job every minute under a fixed scheduler
// id, so however many workers start it runs once a minute.
@Injectable()
class LiveIdleJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('LiveIdle');
  private readonly prisma: PrismaClient;
  private readonly jobs: Queue;
  private readonly worker: Worker;

  constructor(@Inject(OPTIONS) options: LiveIdleOptions) {
    this.prisma = createPrisma(options.databaseUrl);
    const connection = { maxRetriesPerRequest: null, url: options.redisUrl };
    this.jobs = new Queue(LIVE_IDLE_QUEUE, {
      connection,
      telemetry: queueTelemetry(),
    });
    observeQueue(this.jobs);
    const deps = {
      audit: new AuditService(),
      logger: this.logger,
      prisma: this.prisma,
      provider: providerFor(options.liveVideo),
    };
    this.worker = new Worker(
      LIVE_IDLE_QUEUE,
      (job) => inJob(job, () => stopIdleSessions(deps, new Date())),
      { connection, telemetry: queueTelemetry() },
    );
    logFinalFailure(this.worker, this.logger);
    observeWorker(this.worker, { jobNames: [CHECK_JOB] });
  }

  async onApplicationBootstrap() {
    await this.jobs.upsertJobScheduler(
      CHECK_JOB,
      { every: LIVE_IDLE.everyMs },
      {
        name: CHECK_JOB,
        opts: { removeOnComplete: true, removeOnFail: 10 },
      },
    );
  }

  async onApplicationShutdown() {
    await this.worker.close();
    await this.jobs.close();
    await this.prisma.$disconnect();
  }
}

@Module({})
export class LiveIdleModule {
  static registerWorker(options: LiveIdleOptions): DynamicModule {
    return {
      module: LiveIdleModule,
      providers: [{ provide: OPTIONS, useValue: options }, LiveIdleJobs],
    };
  }
}
