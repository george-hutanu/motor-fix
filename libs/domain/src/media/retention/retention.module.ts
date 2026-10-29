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

import { runMediaRetention } from './retention';
import { MEDIA_RETENTION, MEDIA_RETENTION_QUEUE } from './retention.config';
import { AuditService } from '../../audit/audit.service';
import { createPrisma } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';
import { logFinalFailure } from '../../job-failures';
import {
  type LiveVideoConfig,
  providerFor,
} from '../../live-video/live-video.module';
import { inJob } from '../../logging';
import { StorageService } from '../../storage/storage.service';

const NIGHTLY_JOB = 'media-retention-nightly';

interface MediaRetentionOptions {
  databaseUrl: string;
  redisUrl: string;
  liveVideo: LiveVideoConfig;
}

const OPTIONS = Symbol('MEDIA_RETENTION_OPTIONS');

// The nightly media purge: one repeatable job under a fixed scheduler id,
// so however many workers start it runs once a night.
@Injectable()
class MediaRetentionJobs
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('MediaRetention');
  private readonly prisma: PrismaClient;
  private readonly jobs: Queue;
  private readonly worker: Worker;

  constructor(
    @Inject(OPTIONS) options: MediaRetentionOptions,
    storage: StorageService,
  ) {
    this.prisma = createPrisma(options.databaseUrl);
    const connection = { maxRetriesPerRequest: null, url: options.redisUrl };
    this.jobs = new Queue(MEDIA_RETENTION_QUEUE, {
      connection,
      telemetry: queueTelemetry(),
    });
    observeQueue(this.jobs);
    const deps = {
      audit: new AuditService(),
      logger: this.logger,
      prisma: this.prisma,
      provider: providerFor(options.liveVideo),
      storage,
    };
    this.worker = new Worker(
      MEDIA_RETENTION_QUEUE,
      (job) => inJob(job, () => runMediaRetention(deps, new Date())),
      { connection, telemetry: queueTelemetry() },
    );
    logFinalFailure(this.worker, this.logger);
    observeWorker(this.worker, { jobNames: [NIGHTLY_JOB] });
  }

  async onApplicationBootstrap() {
    await this.jobs.upsertJobScheduler(
      NIGHTLY_JOB,
      { pattern: MEDIA_RETENTION.cron, tz: MEDIA_RETENTION.tz },
      {
        name: NIGHTLY_JOB,
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
export class MediaRetentionModule {
  static registerWorker(options: MediaRetentionOptions): DynamicModule {
    return {
      module: MediaRetentionModule,
      providers: [{ provide: OPTIONS, useValue: options }, MediaRetentionJobs],
    };
  }
}
