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

import { type BackupLister, backupLister } from './probes/probes';
import { liveProbes, type RunOptions, runChecks } from './run';
import { parseThresholds, type Thresholds } from './thresholds';
import { createPrisma } from '../auth/prisma';
import { outbox } from '../events/event.port';
import type { PrismaClient } from '../generated/prisma/client';
import { logFinalFailure } from '../job-failures';
import { inJob } from '../logging';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.service';
import { borrowStore, returnStore } from '../store/store';

export const STATUS_QUEUE = 'status-checks';
const EVERY_MS = 30_000;

interface StatusOptions extends Omit<RunOptions, 'backup'> {
  // The environment whose backups are read, and the BACKUP_S3_* settings.
  appEnv: string;
  backupEnv: Record<string, string | undefined>;
  databaseUrl: string;
  redisUrl: string;
  // STATUS_THRESHOLDS, as configured.
  thresholds: string | undefined;
}

const OPTIONS = Symbol('STATUS_OPTIONS');
const THRESHOLDS = Symbol('STATUS_THRESHOLDS');

// The admin dashboard's service tiles: one job every 30 seconds probes them
// and stores their state. Each run is its own attempt; the next one follows.
@Injectable()
class StatusChecks implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('StatusChecks');
  private readonly prisma: PrismaClient;
  private readonly redis: Redis;
  private readonly jobs: Queue;
  private readonly notifications: Queue;
  private readonly worker: Worker;
  private readonly backup: BackupLister | undefined;

  constructor(
    @Inject(OPTIONS) options: StatusOptions,
    @Inject(THRESHOLDS) thresholds: Thresholds,
  ) {
    const connection = { maxRetriesPerRequest: null, url: options.redisUrl };
    this.prisma = createPrisma(options.databaseUrl);
    this.redis = borrowStore(options.redisUrl);
    this.jobs = new Queue(STATUS_QUEUE, {
      connection,
      telemetry: queueTelemetry(),
    });
    observeQueue(this.jobs);
    this.notifications = new Queue(NOTIFICATIONS_QUEUE, { connection });
    this.backup = backupLister(options.appEnv, options.backupEnv);
    const probes = liveProbes(
      { ...options, backup: this.backup?.list },
      this.prisma,
      this.notifications,
    );
    this.worker = new Worker(
      STATUS_QUEUE,
      (job) =>
        inJob(job, async () => {
          const changes = await runChecks({
            events: outbox,
            prisma: this.prisma,
            probes,
            samples: this.redis,
            thresholds,
          });
          for (const { detail, state, tile } of changes) {
            const figure = Object.entries(detail)
              .map(([name, value]) => `${name}=${value}`)
              .join(' ');
            this.logger.log(`${tile} ${state} ${figure}`);
          }
        }),
      { connection, telemetry: queueTelemetry() },
    );
    logFinalFailure(this.worker, this.logger);
    observeWorker(this.worker);
  }

  async onApplicationBootstrap() {
    await this.jobs.upsertJobScheduler(
      STATUS_QUEUE,
      { every: EVERY_MS },
      {
        name: STATUS_QUEUE,
        opts: { attempts: 1, removeOnComplete: true, removeOnFail: 10 },
      },
    );
  }

  async onApplicationShutdown() {
    await this.worker.close();
    await this.jobs.close();
    await this.notifications.close();
    this.backup?.destroy();
    await returnStore(this.redis);
    await this.prisma.$disconnect();
  }
}

@Module({})
export class StatusModule {
  // Without valid limits the checks stay off, as the tiles keep their state.
  static registerWorker(options: StatusOptions): DynamicModule {
    let thresholds: Thresholds;
    try {
      thresholds = parseThresholds(options.thresholds);
    } catch (error) {
      new Logger('StatusChecks').warn(
        `service checks off: ${(error as Error).message}`,
      );
      return { module: StatusModule };
    }
    return {
      module: StatusModule,
      providers: [
        { provide: OPTIONS, useValue: options },
        { provide: THRESHOLDS, useValue: thresholds },
        StatusChecks,
      ],
    };
  }
}
