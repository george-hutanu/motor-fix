import {
  observeQueue,
  observeWorker,
  queueTelemetry,
} from '@motor-fix/observability';
import {
  type DynamicModule,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';

import { writeSnapshot } from './platform-figures';
import { writeResponseStats } from './response-stats/response-stats';
import { createPrisma } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';
import { logFinalFailure } from '../job-failures';
import { inJob } from '../logging';

export const INSIGHTS_QUEUE = 'insights';
const INSIGHTS_PRISMA = Symbol('INSIGHTS_PRISMA');
const INSIGHTS_JOBS = Symbol('INSIGHTS_JOBS');
const INSIGHTS_WORKER = Symbol('INSIGHTS_WORKER');

const SNAPSHOT = 'platform-daily';
const RESPONSE_STATS = 'response-stats';
const NIGHTLY = { pattern: '0 1 * * *', tz: 'Europe/Bucharest' };

interface InsightsOptions {
  databaseUrl: string;
  redisUrl: string;
}

// One scheduler per job under a fixed id, so every worker that starts
// upserts the same ones. A missed or failed snapshot is not run again: the
// deltas then show no line until the next month's first row. The response
// figures are retried, since every profile shows them.
@Module({})
export class InsightsModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    @Inject(INSIGHTS_PRISMA) private readonly prisma: PrismaClient,
    @Inject(INSIGHTS_JOBS) private readonly jobs: Queue,
    @Inject(INSIGHTS_WORKER) private readonly worker: Worker,
  ) {}

  static registerWorker(options: InsightsOptions): DynamicModule {
    const logger = new Logger('Insights');
    return {
      module: InsightsModule,
      providers: [
        {
          provide: INSIGHTS_PRISMA,
          useFactory: () => createPrisma(options.databaseUrl),
        },
        {
          provide: INSIGHTS_JOBS,
          useFactory: () => {
            const queue = new Queue(INSIGHTS_QUEUE, {
              connection: { url: options.redisUrl },
              telemetry: queueTelemetry(),
            });
            observeQueue(queue);
            return queue;
          },
        },
        {
          inject: [INSIGHTS_PRISMA],
          provide: INSIGHTS_WORKER,
          useFactory: (prisma: PrismaClient) => {
            const worker = new Worker(
              INSIGHTS_QUEUE,
              (job) =>
                inJob(job, async () => {
                  if (job.name === SNAPSHOT) {
                    return writeSnapshot(prisma, new Date());
                  }
                  if (job.name === RESPONSE_STATS) {
                    const { computed, written } = await writeResponseStats(
                      prisma,
                      new Date(),
                    );
                    logger.log(
                      `${RESPONSE_STATS} computed ${computed}, written ${written}`,
                    );
                    return;
                  }
                  throw new Error(`unknown job ${job.name}`);
                }),
              {
                connection: {
                  maxRetriesPerRequest: null,
                  url: options.redisUrl,
                },
                telemetry: queueTelemetry(),
              },
            );
            logFinalFailure(worker, logger);
            observeWorker(worker);
            return worker;
          },
        },
      ],
    };
  }

  async onApplicationBootstrap() {
    await this.jobs.upsertJobScheduler(SNAPSHOT, NIGHTLY, {
      name: SNAPSHOT,
      opts: { attempts: 1, removeOnComplete: true, removeOnFail: 10 },
    });
    await this.jobs.upsertJobScheduler(RESPONSE_STATS, NIGHTLY, {
      name: RESPONSE_STATS,
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
