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

import { purgeSystemLog } from './purge';
import { systemLog } from './system-log';
import { createPrisma } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';
import { borrowStore, returnStore } from '../../store/store';

export const SYSTEM_LOG_QUEUE = 'system-log';
const PURGE = 'system-log-purge';
const NIGHTLY = { pattern: '30 3 * * *', tz: 'Europe/Bucharest' };

interface SystemLogOptions {
  databaseUrl: string;
  redisUrl: string;
}

interface SystemLogWorkerOptions extends SystemLogOptions {
  // RELEASE_SHA: the release this worker runs; 'dev' or unset is no release.
  version: string | undefined;
}

const OPTIONS = Symbol('SYSTEM_LOG_OPTIONS');

// Starts the process's writer of the system status log and stops it with the
// application; it writes on a client of its own.
@Injectable()
class SystemLogWriter implements OnApplicationShutdown {
  readonly prisma: PrismaClient;
  private readonly redis: Redis;
  private readonly ports: { prisma: PrismaClient; redis: Redis };

  constructor(@Inject(OPTIONS) options: SystemLogOptions) {
    this.prisma = createPrisma(options.databaseUrl);
    this.redis = borrowStore(options.redisUrl);
    this.ports = { prisma: this.prisma, redis: this.redis };
    systemLog.start(this.ports);
  }

  async onApplicationShutdown() {
    systemLog.stop(this.ports);
    await returnStore(this.redis);
    await this.prisma.$disconnect();
  }
}

// The worker's part: the deploy entry when a new release boots, and the
// nightly purge of entries past their retention.
@Injectable()
class SystemLogJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('SystemLog');
  private readonly jobs: Queue;
  private readonly worker: Worker;

  constructor(
    @Inject(OPTIONS) private readonly options: SystemLogWorkerOptions,
    private readonly writer: SystemLogWriter,
  ) {
    const connection = { maxRetriesPerRequest: null, url: options.redisUrl };
    this.jobs = new Queue(SYSTEM_LOG_QUEUE, {
      connection,
      telemetry: queueTelemetry(),
    });
    observeQueue(this.jobs);
    this.worker = new Worker(
      SYSTEM_LOG_QUEUE,
      (job) =>
        inJob(job, async () => {
          const deleted = await purgeSystemLog(writer.prisma, new Date());
          this.logger.log(`system log purge deleted ${deleted} entries`);
        }),
      { connection, telemetry: queueTelemetry() },
    );
    logFinalFailure(this.worker, this.logger);
    observeWorker(this.worker);
  }

  async onApplicationBootstrap() {
    await this.jobs.upsertJobScheduler(PURGE, NIGHTLY, {
      name: PURGE,
      opts: {
        attempts: 3,
        backoff: { delay: 60_000, type: 'exponential' },
        removeOnComplete: true,
        removeOnFail: 10,
      },
    });
    await this.deployed();
  }

  // Once per release: a restart or a second instance of the same version
  // finds it already the newest deploy entry; a rollback is a new one. The
  // lock holds a second instance booting at the same time until the first
  // has written, whichever minute each lands in.
  private async deployed() {
    const { version } = this.options;
    if (!version || version === 'dev') return;
    await this.writer.prisma
      .$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('system_log_deploy'))`;
        const newest = await tx.systemLogEntry.findFirst({
          orderBy: { at: 'desc' },
          where: { kind: 'deploy' },
        });
        if (newest?.fingerprint === version) return;
        await systemLog.write('deploy', 'worker', { version });
      })
      .catch(() =>
        this.logger.warn(`Deploy of ${version} not checked against the log`),
      );
  }

  async onApplicationShutdown() {
    await this.worker.close();
    await this.jobs.close();
  }
}

@Module({})
export class SystemLogModule {
  // The API: the writer only.
  static register(options: SystemLogOptions): DynamicModule {
    return {
      module: SystemLogModule,
      providers: [{ provide: OPTIONS, useValue: options }, SystemLogWriter],
    };
  }

  // The worker: the writer, the deploy entry and the purge.
  static registerWorker(options: SystemLogWorkerOptions): DynamicModule {
    return {
      module: SystemLogModule,
      providers: [
        { provide: OPTIONS, useValue: options },
        SystemLogWriter,
        SystemLogJobs,
      ],
    };
  }
}
